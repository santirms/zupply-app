// services/meliBackfill.js
const { mlGet } = require('../utils/meliUtils');
const { ingestShipment } = require('./meliIngest');

/**
 * Trae órdenes recientes y devuelve IDs de shipments asociados (únicos).
 * Usa /orders/search y toma shipping.id de cada orden.
 */
async function listRecentShipmentIds({ user_id, days = 7 }) {
  // desde hace N días a ahora (ISO)
  const to   = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    seller: String(user_id),
    // rangos de fecha de creación de la orden (formato ISO)
    'order.date_created.from': from.toISOString(),
    'order.date_created.to':   to.toISOString(),
    sort: 'date_desc',
    limit: '50',
    offset: '0'
  });

  const base = 'https://api.mercadolibre.com/orders/search';
  let offset = 0;
  const ids = new Set();

  // paginado simple
  // NOTA: mlGet ya maneja refresh si hace falta.
  while (true) {
    params.set('offset', String(offset));
    const url = `${base}?${params.toString()}`;
    const data = await mlGet(url, { user_id });

    const results = Array.isArray(data?.results) ? data.results : [];
    for (const o of results) {
      const sid = o?.shipping?.id;
      if (sid) ids.add(String(sid));
    }

    const paging = data?.paging || {};
    const total = Number(paging.total || 0);
    const lim   = Number(paging.limit || 50);
    offset += lim;
    if (offset >= total || results.length === 0) break;
  }

  return Array.from(ids);
}

/**
 * Ingesta masiva para un cliente (por user_id) de los últimos N días.
 * Crea/actualiza usando ingestShipment.
 */
async function backfillCliente({ cliente, days = 7, delayMs = 120 }) {
  if (!cliente?.user_id) {
    return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, reason: 'no_user' };
  }
  const shipmentIds = await listRecentShipmentIds({ user_id: cliente.user_id, days });

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const shipmentId of shipmentIds) {
    try {
      const res = await ingestShipment({ shipmentId, cliente });
      // Podés hacer que ingestShipment devuelva un flag { created:true/false }
      if (res?.created === true) created++;
      else if (res?.updated === true) updated++;
      else skipped++;
    } catch (e) {
      errors++;
      console.error('[backfillCliente] error', cliente._id.toString(), shipmentId, e.response?.data || e.message);
    }
    await new Promise(r => setTimeout(r, delayMs));
  }

  return { total: shipmentIds.length, created, updated, skipped, errors };
}

module.exports = { backfillCliente, listRecentShipmentIds };
