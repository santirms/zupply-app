// services/meliSync.js
const Envio    = require('../models/Envio');
const Cliente  = require('../models/Cliente');
const { ingestShipment } = require('./meliIngest');
require('../models/listaDePrecios');


const TERMINALES_MELI = new Set(['delivered', 'cancelled']);
const TERMINALES_INT  = new Set(['entregado', 'cancelado']);

async function fetchPendientes({ limit = 200 } = {}) {
  return Envio.find({
    meli_id: { $ne: null },
    $or: [
      { 'estado_meli.status': { $nin: Array.from(TERMINALES_MELI) } },
      { estado: { $nin: Array.from(TERMINALES_INT) } },
      { 'estado_meli.status': { $exists: false } } // por si no se seteó aún
    ]
  })
  .sort({ updatedAt: 1 }) // más viejos primero
  .limit(limit);
}

/**
 * Recorre envíos no terminales y los re-ingesta desde MeLi.
 * Usa la misma lógica idempotente de ingestShipment (única fuente de verdad).
 */
async function syncPendingShipments({ limit = 200, delayMs = 150 } = {}) {
  const res = {
    total: 0,
    ok: 0,
    fail: 0,
    skipped_no_user: 0,
    skipped_no_meli_id: 0,
    errors_api: 0
  };

  const lot = await fetchPendientes({ limit });
  res.total = lot.length;

  for (const e of lot) {
    if (!e.meli_id) { res.skipped_no_meli_id++; continue; }

    try {
      const cliente = await Cliente.findById(e.cliente_id).populate('lista_precios');
      if (!cliente?.user_id) { res.skipped_no_user++; continue; }

      await ingestShipment({ shipmentId: e.meli_id, cliente });
      res.ok++;
    } catch (err) {
      res.fail++;
      res.errors_api++;
      console.error(
        '[meliSync] sync item error:',
        e._id, e.meli_id,
        err?.response?.status || '',
        err?.response?.data || err.message
      );
    }

    if (delayMs) {
      await new Promise(r => setTimeout(r, delayMs)); // rate-limit suave
    }
  }

  return res;
}

module.exports = { syncPendingShipments };
