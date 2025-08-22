// services/meliSync.js
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { ingestShipment } = require('./meliIngest');

async function syncPendingShipments({ limit = 100, delayMs = 150 } = {}) {
  const pendientes = await Envio.find({
    meli_id: { $ne: null },
    $or: [
      { estado: { $nin: ['entregado','cancelado'] } },
      { 'estado_meli.status': { $nin: ['delivered','cancelled'] } }
    ]
  }).limit(limit);

  let ok = 0, fail = 0;
  for (const e of pendientes) {
    try {
      const cliente = await Cliente.findById(e.cliente_id).populate('lista_precios');
      if (!cliente?.user_id) { fail++; continue; }
      await ingestShipment({ shipmentId: e.meli_id, cliente });
      ok++;
    } catch (err) {
      fail++;
      console.error('sync item error:', e._id, err?.response?.data || err.message);
    }
    if (delayMs) await new Promise(r => setTimeout(r, delayMs)); // rate-limit suave
  }
  return { ok, fail, total: pendientes.length };
}

module.exports = { syncPendingShipments };
