// services/meliHistory.js
const axios  = require('axios');
const Envio  = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');
const { mapMeliToInterno } = require('../utils/meliStatus');

async function fetchShipmentHistory(meli_id, user_id) {
  const access_token = await getValidToken(user_id);
  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${meli_id}/history`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  // ML puede devolver array directo o dentro de results
  return Array.isArray(data) ? data : (data?.results || []);
}

function normalizeHistoryItem(h) {
  const status    = String(h.status || h.new || h.state || '').toLowerCase();
  const substatus = String(h.substatus || h.sub_status || '').toLowerCase();
  const at        = new Date(h.date || h.created || h.updated || Date.now());
  return {
    at,
    estado: mapMeliToInterno(status, substatus),
    estado_meli: { status, substatus },
    source: 'meli:history',
    actor_name: null
  };
}

function mergeUnique(existing = [], incoming = []) {
  const k = x => `${x.estado_meli?.status || ''}|${x.estado_meli?.substatus || ''}|${new Date(x.at).toISOString()}`;
  const m = new Map();
  for (const it of existing) m.set(k(it), it);
  for (const it of incoming) m.set(k(it), it);
  return [...m.values()].sort((a,b) => new Date(a.at) - new Date(b.at));
}

async function ensureMeliHistory(envioOrId) {
  const envio = typeof envioOrId === 'object' && envioOrId._id
    ? envioOrId
    : await Envio.findById(envioOrId).lean();

  if (!envio)              throw new Error('envio not found');
  if (!envio.meli_id)      return { skipped: true, reason: 'no_meli_id' };

  const cliente = await Cliente.findById(envio.cliente_id).select('user_id').lean();
  if (!cliente?.user_id)   return { skipped: true, reason: 'cliente_not_linked' };

  const raw = await fetchShipmentHistory(envio.meli_id, cliente.user_id);
  const items = raw.map(normalizeHistoryItem);

  const merged = mergeUnique(envio.historial || [], items);
  const last   = merged[merged.length - 1];

  // ⚠️ IMPORTANTE: sólo UPDATE, sin upsert y sin crear doc nuevo.
  await Envio.updateOne(
    { _id: envio._id },
    {
      $set: {
        historial: merged,
        ...(last ? {
          estado: last.estado,
          estado_meli: {
            status:    last.estado_meli.status,
            substatus: last.estado_meli.substatus,
            updatedAt: last.at
          }
        } : {}),
        meli_history_last_sync: new Date(),
      }
    },
    { runValidators: false } // <- evita que la validación de `required` salte acá
  );

  return { ok: true, total: merged.length };
}

module.exports = { ensureMeliHistory };
