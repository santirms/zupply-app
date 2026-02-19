const { DateTime } = require('luxon');

const TZ = 'America/Argentina/Buenos_Aires';

/**
 * Obtiene la fecha de ingreso a planta (scan QR) de un envío.
 * Retorna null si el envío nunca fue escaneado → no es facturable.
 */
function getFechaIngresoEnvio(envio) {
  if (!envio?.historial || !Array.isArray(envio.historial)) return null;

  // Buscar el PRIMER evento de scan QR (zupply:qr)
  const scanEvents = envio.historial
    .filter(h => h.source && h.source.startsWith('zupply:qr'))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  if (scanEvents.length === 0) return null;

  return scanEvents[0].at;
}

/**
 * Calcula el rango semanal de facturación (lunes 00:00 AR → sábado 23:59:59 AR)
 * a partir de las fechas "desde" y "hasta" recibidas.
 *
 * Si no se pasan fechas, calcula la semana anterior automáticamente
 * (para uso del cron del domingo).
 */
function calcularRangoFacturacion(desde, hasta) {
  let dtDesde, dtHasta;

  if (desde && hasta) {
    // Parsear fechas como locales Argentina
    if (typeof desde === 'string') {
      dtDesde = DateTime.fromISO(desde, { zone: TZ }).startOf('day');
    } else {
      dtDesde = DateTime.fromJSDate(desde, { zone: TZ }).startOf('day');
    }

    if (typeof hasta === 'string') {
      dtHasta = DateTime.fromISO(hasta, { zone: TZ }).endOf('day');
    } else {
      dtHasta = DateTime.fromJSDate(hasta, { zone: TZ }).endOf('day');
    }
  } else {
    // Sin fechas → calcular semana anterior (lunes a sábado)
    const ahora = DateTime.now().setZone(TZ);
    // Retroceder al lunes de la semana pasada
    const lunesAnterior = ahora.startOf('week').minus({ weeks: 1 });
    dtDesde = lunesAnterior.startOf('day'); // Lunes 00:00
    dtHasta = lunesAnterior.plus({ days: 5 }).endOf('day'); // Sábado 23:59:59
  }

  return {
    desde: dtDesde.toJSDate(),
    hasta: dtHasta.toJSDate(),
    info: {
      desde_str: dtDesde.toISO(),
      hasta_str: dtHasta.toISO(),
      desde_display: dtDesde.toFormat('dd/MM/yyyy'),
      hasta_display: dtHasta.toFormat('dd/MM/yyyy')
    }
  };
}

/**
 * Filtra envíos facturables: solo los que tienen scan QR dentro del rango.
 *
 * @param {Array} envios - Envíos candidatos (ya traídos de la DB)
 * @param {Date|string} desde - Inicio del período
 * @param {Date|string} hasta - Fin del período
 * @returns {Array} Envíos facturables
 */
function filtrarEnviosFacturables(envios, desde, hasta) {
  // Nota: ya no recibe 'cliente' como parámetro — la regla es universal
  const rango = calcularRangoFacturacion(desde, hasta);

  let facturables = 0;
  let sinScan = 0;
  let fueraRango = 0;

  const resultado = envios.filter(envio => {
    const fechaIngreso = getFechaIngresoEnvio(envio);

    // Sin scan QR → no facturable
    if (!fechaIngreso) {
      sinScan++;
      return false;
    }

    // Verificar que el scan QR fue dentro del rango
    const fechaScan = new Date(fechaIngreso);
    const enRango = fechaScan >= rango.desde && fechaScan <= rango.hasta;

    if (enRango) {
      facturables++;
    } else {
      fueraRango++;
    }

    return enRango;
  });

  console.log('📊 Filtrado facturación:', {
    total_candidatos: envios.length,
    facturables,
    sin_scan_qr: sinScan,
    fuera_rango: fueraRango,
    rango: rango.info
  });

  return resultado;
}

/**
 * Genera query de MongoDB para envíos potencialmente facturables.
 * Trae envíos amplios — el filtrado fino se hace en memoria con filtrarEnviosFacturables.
 *
 * @param {string} clienteId - ID del cliente (o null para todos)
 * @param {Date} desde - Inicio del período
 * @param {Date} hasta - Fin del período
 * @returns {Object} Query de MongoDB
 */
function buildQueryFacturacion(clienteId, desde, hasta) {
  const rango = calcularRangoFacturacion(desde, hasta);

  const query = {
    // Solo envíos que tienen al menos un evento de scan QR
    'historial.source': { $regex: /^zupply:qr/ },
    // Con fecha de scan QR en el rango (aproximado, el filtro fino es en memoria)
    'historial.at': { $gte: rango.desde, $lte: rango.hasta }
  };

  if (clienteId) {
    query.cliente_id = clienteId;
  }

  return query;
}

/**
 * Calcula automáticamente el rango de la semana pasada (para el cron del domingo).
 * Retorna { desde: Date, hasta: Date } del lunes 00:00 AR al sábado 23:59 AR.
 */
function calcularSemanaAnterior() {
  const ahora = DateTime.now().setZone(TZ);
  const lunesAnterior = ahora.startOf('week').minus({ weeks: 1 });
  const sabadoAnterior = lunesAnterior.plus({ days: 5 });

  return {
    desde: lunesAnterior.startOf('day').toJSDate(),
    hasta: sabadoAnterior.endOf('day').toJSDate(),
    label: `${lunesAnterior.toFormat('dd/MM')} al ${sabadoAnterior.toFormat('dd/MM/yyyy')}`
  };
}

module.exports = {
  getFechaIngresoEnvio,
  calcularRangoFacturacion,
  filtrarEnviosFacturables,
  buildQueryFacturacion,
  calcularSemanaAnterior
};
