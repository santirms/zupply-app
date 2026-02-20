const { DateTime } = require('luxon');

const TZ = 'America/Argentina/Buenos_Aires';

// Sources que indican que un envío pasó por planta
const SOURCES_PLANTA = ['zupply:qr', 'scanner'];

/**
 * Verifica si un source de historial indica ingreso a planta
 */
function esEventoPlanta(source) {
  if (!source) return false;
  return SOURCES_PLANTA.some(s => source === s || source.startsWith(s));
}

/**
 * Obtiene la fecha de ingreso a planta de un envío.
 * Busca el PRIMER evento con source 'zupply:qr' o 'scanner'.
 * Retorna null si el envío nunca pasó por planta → no es facturable.
 */
function getFechaIngresoEnvio(envio) {
  if (!envio?.historial || !Array.isArray(envio.historial)) return null;

  // Buscar el PRIMER evento de planta, ordenado por fecha
  const eventosPlanta = envio.historial
    .filter(h => h.at && esEventoPlanta(h.source))
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  if (eventosPlanta.length === 0) return null;

  return eventosPlanta[0].at;
}

/**
 * Calcula el rango de fechas para facturación.
 * Parsea las fechas en timezone Argentina (-03:00).
 *
 * Si no se pasan fechas, calcula la semana anterior (lunes a sábado).
 */
function calcularRangoFacturacion(desde, hasta) {
  let dtDesde, dtHasta;

  if (desde && hasta) {
    // Parsear como fechas locales Argentina
    if (typeof desde === 'string') {
      dtDesde = DateTime.fromISO(desde.length <= 10 ? desde + 'T00:00:00' : desde, { zone: TZ }).startOf('day');
    } else {
      dtDesde = DateTime.fromJSDate(desde, { zone: TZ }).startOf('day');
    }

    if (typeof hasta === 'string') {
      dtHasta = DateTime.fromISO(hasta.length <= 10 ? hasta + 'T23:59:59' : hasta, { zone: TZ }).endOf('day');
    } else {
      dtHasta = DateTime.fromJSDate(hasta, { zone: TZ }).endOf('day');
    }
  } else {
    // Sin fechas → semana anterior (lunes a sábado)
    const ahora = DateTime.now().setZone(TZ);
    const lunesAnterior = ahora.startOf('week').minus({ weeks: 1 });
    dtDesde = lunesAnterior.startOf('day');
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
 * Filtra envíos facturables: solo los que pasaron por planta dentro del rango.
 *
 * @param {Array} envios - Envíos candidatos (ya traídos de la DB)
 * @param {Date|string} desde - Inicio del período
 * @param {Date|string} hasta - Fin del período
 * @returns {Array} Envíos facturables
 */
function filtrarEnviosFacturables(envios, desde, hasta) {
  const rango = calcularRangoFacturacion(desde, hasta);

  let facturables = 0;
  let sinPlanta = 0;
  let fueraRango = 0;

  const resultado = envios.filter(envio => {
    const fechaIngreso = getFechaIngresoEnvio(envio);

    if (!fechaIngreso) {
      sinPlanta++;
      return false;
    }

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
    sin_ingreso_planta: sinPlanta,
    fuera_rango: fueraRango,
    rango: rango.info
  });

  return resultado;
}

/**
 * Genera query de MongoDB para envíos potencialmente facturables.
 * Trae envíos amplios — el filtrado fino se hace en memoria.
 */
function buildQueryFacturacion(clienteId, desde, hasta) {
  const rango = calcularRangoFacturacion(desde, hasta);

  const query = {
    // Solo envíos que tienen al menos un evento de planta
    $or: [
      { 'historial.source': 'zupply:qr' },
      { 'historial.source': 'scanner' }
    ],
    // Con fecha de evento en el rango (filtro grueso, el fino es en memoria)
    'historial.at': { $gte: rango.desde, $lte: rango.hasta }
  };

  if (clienteId) {
    query.cliente_id = clienteId;
  }

  return query;
}

/**
 * Calcula el rango de la semana pasada para el cron del domingo.
 * Retorna lunes 00:00 AR → sábado 23:59:59 AR.
 */
function calcularSemanaAnterior() {
  const ahora = DateTime.now().setZone(TZ);
  const lunesAnterior = ahora.startOf('week').minus({ weeks: 1 });
  const sabadoAnterior = lunesAnterior.plus({ days: 5 });

  return {
    desde: lunesAnterior.startOf('day').toJSDate(),
    hasta: sabadoAnterior.endOf('day').toJSDate(),
    label: lunesAnterior.toFormat('dd/MM') + ' al ' + sabadoAnterior.toFormat('dd/MM/yyyy')
  };
}

module.exports = {
  getFechaIngresoEnvio,
  calcularRangoFacturacion,
  filtrarEnviosFacturables,
  buildQueryFacturacion,
  calcularSemanaAnterior
};
