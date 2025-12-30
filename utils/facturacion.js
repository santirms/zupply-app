const { DateTime } = require('luxon');

/**
 * Determina la fecha de ingreso al sistema según el origen del envío
 */
function getFechaIngresoEnvio(envio) {
  const origen = envio.origen;

  // 1. AUTO-INGESTA (ML sincronizado automáticamente)
  // origen: 'mercadolibre' + requiere_sync: true
  // → Usar campo "fecha" (cuando ML lo creó)
  if (origen === 'mercadolibre' && envio.requiere_sync_meli === true) {
    // Pero si NO tiene auto_ingesta (es escaneo manual), usar fecha de escaneo
    if (envio.historial?.length > 0) {
      const eventoEscaneo = envio.historial.find(h =>
        h.source === 'zupply:qr' && h.estado === 'asignado'
      );
      if (eventoEscaneo) {
        return eventoEscaneo.at; // Es escaneo, no auto-ingesta
      }
    }

    // Si no hay escaneo, es auto-ingesta real
    return envio.fecha;
  }

  // 2. ETIQUETAS PDF (subida de archivos)
  // origen: 'etiquetas'
  // → Usar campo "fecha" (cuando se subió el PDF)
  if (origen === 'etiquetas') {
    return envio.fecha;
  }

  // 3. INGRESO MANUAL (creado manualmente en el sistema)
  // origen: 'ingreso_manual'
  // → Usar fecha del primer evento del historial (cuando se creó/asignó)
  if (origen === 'ingreso_manual') {
    if (envio.historial?.length > 0) {
      return envio.historial[0].at;
    }
    return envio.fecha || envio.createdAt;
  }

  // Fallback: usar fecha o createdAt
  return envio.fecha || envio.createdAt || envio.updatedAt;
}

/**
 * Calcula el rango de fechas ajustado según horarios de corte del cliente
 */
function calcularRangoFacturacion(desde, hasta, cliente) {
  // Asegurar que desde y hasta son objetos Date
  const desdeDate = desde instanceof Date ? desde : new Date(desde);
  const hastaDate = hasta instanceof Date ? hasta : new Date(hasta);

  // Si el cliente NO tiene configuración de facturación, usar rango exacto
  if (!cliente || !cliente.facturacion) {
    desdeDate.setHours(0, 0, 0, 0);
    hastaDate.setHours(23, 59, 59, 999);

    return {
      desde: desdeDate,
      hasta: hastaDate,
      info: {
        desde_str: desdeDate.toISOString(),
        hasta_str: hastaDate.toISOString(),
        sin_configuracion: true
      }
    };
  }

  // Cliente CON configuración → aplicar horarios de corte
  const tz = cliente.facturacion.zona_horaria || 'America/Argentina/Buenos_Aires';

  let dtDesde = DateTime.fromJSDate(desdeDate, { zone: tz });
  let dtHasta = DateTime.fromJSDate(hastaDate, { zone: tz });

  // ========== AJUSTAR DÍA DESDE (después del corte) ==========
  const diaSemanaDe = dtDesde.weekday;
  let horarioCorteDe;

  if (diaSemanaDe === 7) {
    horarioCorteDe = cliente.facturacion.horario_corte_domingo || '12:00';
  } else if (diaSemanaDe === 6) {
    horarioCorteDe = cliente.facturacion.horario_corte_sabado || '12:00';
  } else {
    horarioCorteDe = cliente.facturacion.horario_corte_lunes_viernes || '13:00';
  }

  const [horaIni, minIni] = horarioCorteDe.split(':').map(Number);

  // Desde = día inicial, DESPUÉS del corte (HH:MM:01)
  dtDesde = dtDesde.set({ hour: horaIni, minute: minIni, second: 1, millisecond: 0 });

  // ========== AJUSTAR DÍA HASTA (en el corte) ==========
  const diaSemanaHasta = dtHasta.weekday;
  let horarioCorteHasta;

  if (diaSemanaHasta === 7) {
    horarioCorteHasta = cliente.facturacion.horario_corte_domingo;
    if (!horarioCorteHasta) {
      dtHasta = dtHasta.minus({ days: 1 });
      horarioCorteHasta = cliente.facturacion.horario_corte_sabado || '12:00';
    }
  } else if (diaSemanaHasta === 6) {
    horarioCorteHasta = cliente.facturacion.horario_corte_sabado || '12:00';
  } else {
    horarioCorteHasta = cliente.facturacion.horario_corte_lunes_viernes || '13:00';
  }

  const [horaFin, minFin] = horarioCorteHasta.split(':').map(Number);

  // Hasta = día final, EN el corte (HH:MM:00)
  dtHasta = dtHasta.set({ hour: horaFin, minute: minFin, second: 0, millisecond: 0 });

  const rangoFinal = {
    desde: dtDesde.toJSDate(),
    hasta: dtHasta.toJSDate(),
    info: {
      desde_str: dtDesde.toISO(),
      hasta_str: dtHasta.toISO(),
      corte_desde: horarioCorteDe,
      corte_hasta: horarioCorteHasta,
      dia_desde: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][diaSemanaDe],
      dia_hasta: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][diaSemanaHasta]
    }
  };

  console.log('📊 Rango ajustado:', rangoFinal.info);

  return rangoFinal;
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
