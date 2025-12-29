const { DateTime } = require('luxon');

/**
 * Determina la fecha de ingreso al sistema según el origen del envío
 */
function getFechaIngresoEnvio(envio) {
  const origen = envio.origen;

  // 1. AUTO-INGESTA: usar campo "fecha"
  if (origen === 'mercadolibre' && envio.requiere_sync_meli === true) {
    return envio.fecha;
  }

  // 2. ESCANEO: buscar primer evento con source "MeLi" o que contenga "meli"
  if (origen === 'etiquetas' && envio.historial?.length > 0) {
    const eventoMeLi = envio.historial.find(h =>
      h.source?.toLowerCase().includes('meli') ||
      h.actor_name?.toLowerCase().includes('meli')
    );

    if (eventoMeLi) {
      return eventoMeLi.at; // Es escaneo
    }

    // Si no hay evento de MeLi, es subida de etiquetas PDF
    return envio.fecha;
  }

  // 3. ETIQUETAS PDF: usar campo "fecha"
  if (origen === 'etiquetas') {
    return envio.fecha;
  }

  // 4. MANUAL: usar campo "fecha"
  if (origen === 'ingreso_manual') {
    return envio.fecha;
  }

  // Fallback: usar fecha o createdAt
  return envio.fecha || envio.createdAt || envio.updatedAt;
}

/**
 * Calcula el rango de fechas ajustado según horarios de corte del cliente
 */
function calcularRangoFacturacion(desde, hasta, cliente) {
  const tz = cliente.facturacion?.zona_horaria || 'America/Argentina/Buenos_Aires';

  // Convertir fechas a DateTime de Luxon con timezone
  let dtDesde = DateTime.fromJSDate(desde, { zone: tz }).startOf('day');
  let dtHasta = DateTime.fromJSDate(hasta, { zone: tz }).endOf('day');

  // Ajustar hora de corte del día "hasta"
  const diaSemanaHasta = dtHasta.weekday; // 1=lunes, 7=domingo
  let horarioCorte;

  if (diaSemanaHasta === 7) {
    // Domingo
    horarioCorte = cliente.facturacion?.horario_corte_domingo;
    if (!horarioCorte) {
      // Si no trabaja domingos, retroceder al sábado
      dtHasta = dtHasta.minus({ days: 1 });
      horarioCorte = cliente.facturacion?.horario_corte_sabado || '12:00';
    }
  } else if (diaSemanaHasta === 6) {
    // Sábado
    horarioCorte = cliente.facturacion?.horario_corte_sabado || '12:00';
  } else {
    // Lunes a Viernes
    horarioCorte = cliente.facturacion?.horario_corte_lunes_viernes || '13:00';
  }

  // Parsear horario (formato "HH:MM")
  const [hora, minuto] = horarioCorte.split(':').map(Number);

  // Ajustar dtHasta al horario de corte
  dtHasta = dtHasta.set({ hour: hora, minute: minuto, second: 59, millisecond: 999 });

  return {
    desde: dtDesde.toJSDate(),
    hasta: dtHasta.toJSDate(),
    info: {
      desde_str: dtDesde.toISO(),
      hasta_str: dtHasta.toISO(),
      horario_corte: horarioCorte,
      dia_semana: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][diaSemanaHasta]
    }
  };
}

/**
 * Filtra envíos por rango de facturación considerando origen y horarios de corte
 */
function filtrarEnviosFacturables(envios, desde, hasta, cliente) {
  const rango = calcularRangoFacturacion(desde, hasta, cliente);

  return envios.filter(envio => {
    const fechaIngreso = getFechaIngresoEnvio(envio);
    if (!fechaIngreso) return false;

    const fechaDate = new Date(fechaIngreso);
    return fechaDate >= rango.desde && fechaDate <= rango.hasta;
  });
}

/**
 * Genera query de MongoDB para envíos facturables
 * NOTA: La query trae todos los envíos del cliente, luego se filtran en memoria
 */
function buildQueryFacturacion(clienteId, desde, hasta, cliente) {
  // Estados válidos para facturación
  const estadosFacturables = [
    'asignado',
    'en_camino',
    'en_planta',
    'entregado',
    'comprador_ausente',
    'inaccesible',
    'rechazado'
  ];

  // Query base: traer envíos del cliente con estados facturables
  // Ampliamos el rango para incluir todos los posibles
  const query = {
    cliente_id: clienteId,
    estado: { $in: estadosFacturables },
    $or: [
      { fecha: { $gte: desde, $lte: hasta } },
      { createdAt: { $gte: desde, $lte: hasta } },
      {
        'historial.at': { $gte: desde, $lte: hasta }
      }
    ]
  };

  return query;
}

module.exports = {
  getFechaIngresoEnvio,
  calcularRangoFacturacion,
  filtrarEnviosFacturables,
  buildQueryFacturacion
};
