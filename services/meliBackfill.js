// services/meliBackfill.js
const { mlGet } = require('../utils/meliUtils');
const logger = require('../utils/logger');
const { ingestShipment } = require('./meliIngest');

/**
 * Trae órdenes recientes y devuelve IDs de shipments asociados (únicos).
 * Usa /orders/search y toma shipping.id de cada orden.
 */
const { mlGet, mlGetWithTenant } = require('../utils/meliUtils');

async function listRecentShipmentIds({ user_id, days = 7, mlToken, tenantId }) {
  const to   = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const params = new URLSearchParams({
    seller: String(user_id),
    'order.date_created.from': from.toISOString(),
    'order.date_created.to':   to.toISOString(),
    sort: 'date_desc',
    limit: '50',
    offset: '0'
  });
  
  const base = 'https://api.mercadolibre.com/orders/search';
  let offset = 0;
  const ids = new Set();

  while (true) {
    params.set('offset', String(offset));
    const url = `${base}?${params.toString()}`;
    
    // ← CAMBIAR: Usar mlGetWithTenant si tenemos tenantId
    const data = tenantId 
      ? await mlGetWithTenant(url, { tenantId, mlToken })
      : await mlGet(url, { user_id, mlToken });
    
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
async function backfillCliente({ cliente, days = 7, delayMs = 120, tenantId, mlToken }) {
  if (!cliente?.user_id) {
    logger.warn('Backfill skipped: client without user_id', {
      cliente_id: cliente?._id?.toString?.()
    });
    return { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, reason: 'no_user' };
  }
  const shipmentIds = await listRecentShipmentIds({ user_id: cliente.user_id, days, mlToken, tenantId });

  let created = 0, updated = 0, skipped = 0, errors = 0;
  for (const shipmentId of shipmentIds) {
    try {
      const res = await ingestShipment({ shipmentId, cliente, tenantId, mlToken });
      // Podés hacer que ingestShipment devuelva un flag { created:true/false }
      if (res?.created === true) created++;
      else if (res?.updated === true) updated++;
      else skipped++;
    } catch (e) {
      errors++;
      const errorMessage = e?.message || (typeof e === 'string' ? e : 'Unknown error');
      if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        logger.debug('ML timeout durante backfill (esperado)', {
          order_id: shipmentId,
          cliente_id: cliente?._id?.toString?.()
        });
      } else {
        logger.error('Backfill error', {
          cliente_id: cliente?._id?.toString?.(),
          order_id: shipmentId,
          error: errorMessage
        });
      }
    }
    await new Promise(r => setTimeout(r, delayMs));
  }

  const resultado = { total: shipmentIds.length, created, updated, skipped, errors };
  logger.info('Backfill completed', {
    cliente: cliente?.nombre || cliente?._id?.toString?.(),
    total: resultado.total,
    created: resultado.created,
    updated: resultado.updated,
    skipped: resultado.skipped,
    errors: resultado.errors
  });

  return resultado;
}

module.exports = { backfillCliente, listRecentShipmentIds };
