// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;

function keyOf(h) {
  const ts = +new Date(h.at || h.updatedAt || 0);
  const st = (h.estado || '').toLowerCase();
  const sub = (h.estado_meli?.substatus || '').toLowerCase();
  return `${ts}|${st}|${sub}`;
}

function mapHistory(items = []) {
  return items.map(e => ({
    at: new Date(e.date),
    estado: e.status,
    estado_meli: { status: e.status, substatus: e.substatus || '' },
    actor_name: 'MeLi',
    source: 'meli-history',
  }));
}

function mapToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}

async function ensureMeliHistory(envioOrId, { token, force = false } = {}) {
  const envio = typeof envioOrId === 'string'
    ? await Envio.findById(envioOrId).lean()
    : (envioOrId.toObject ? envioOrId.toObject() : envioOrId);

  if (!envio?.meli_id) return;

  const last = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;
  if (!force && fresh && !pobre) return;

  // token
  let access = token;
  if (!access) {
    const cliente = await Cliente.findById(envio.cliente_id).lean();
    if (!cliente?.user_id) return;
    access = await getValidToken(cliente.user_id);
  }

  // history
  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${envio.meli_id}/history`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const raw = Array.isArray(data) ? data : (data.results || []);
  const mapped = mapHistory(raw);

  // traer historial actual y deduplicar
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const seen = new Set(current.map(keyOf));
  const toAdd = mapped.filter(h => !seen.has(keyOf(h)));
  const lastEvt = mapped.sort((a,b) => new Date(b.at) - new Date(a.at))[0];

  const update = {
    $set: { meli_history_last_sync: new Date() }
  };
  if (toAdd.length) {
    update.$push = { historial: { $each: toAdd } };
  }
  if (lastEvt) {
    const st  = lastEvt.estado_meli?.status || lastEvt.estado;
    const sub = lastEvt.estado_meli?.substatus || '';
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt.at };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
