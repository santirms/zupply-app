// services/meliSync.js
const Envio    = require('../models/Envio');
const Cliente  = require('../models/Cliente');
const { ingestShipment } = require('./meliIngest');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Sincroniza envíos con MeLi que no están en estado terminal.
 * Devuelve métricas de la corrida.
 */
async function syncPendingShipments({ limit = 200, delayMs = 150 } = {}) {
  // Trae envíos con meli_id y no terminales (interno o ML)
  const candidatos = await Envio.find({
    meli_id: { $ne: null },
    $or: [
      { estado: { $nin: ['entregado', 'cancelado'] } },
      { 'estado_meli.status': { $nin: ['delivered', 'cancelled'] } },
    ],
  })
  .limit(limit)
  .select('_id meli_id cliente_id')
  .lean(); // no necesitamos doc completo acá

  let ok = 0, fail = 0, errors_api = 0, skipped_no_user = 0, skipped_no_meli_id = 0;

  for (const e of candidatos) {
    // guardas útiles para logs dentro del catch
    const envioId = e._id?.toString?.() || String(e._id);
    const meliId  = e.meli_id || null;

    try {
      if (!meliId) { skipped_no_meli_id++; continue; }

      // Traer cliente con lista de precios (necesario para ingest)
      const clienteDoc = await Cliente.findById(e.cliente_id).populate('lista_precios');
      if (!clienteDoc || !clienteDoc.user_id) {
        skipped_no_user++;
        continue;
      }

      // Ingesta idempotente (crea/actualiza estado, precio, etc.)
      await ingestShipment({ shipmentId: meliId, cliente: clienteDoc });
      ok++;

      // rate limit suave
      if (delayMs > 0) await sleep(delayMs);

    } catch (err) {
      fail++;
      // si es error de API (por ejemplo 4xx/5xx), lo contamos aparte
      if (err?.response?.status) errors_api++;
      console.error('[meliSync] sync item error:', {
        envio_id: envioId,
        meli_id: meliId,
        error: err?.response?.data || err?.message || String(err),
      });
      // seguimos con el próximo
    }
  }

  return { total: candidatos.length, ok, fail, skipped_no_user, skipped_no_meli_id, errors_api };
}

module.exports = { syncPendingShipments };
