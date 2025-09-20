// scripts/hydrate-delivered-today.js
require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');
const axios = require('axios');

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

const keyOf = h =>
  `${+new Date(h.at || h.updatedAt || 0)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}`;

const mapHist = items => items.map(e => ({
  at: new Date(e.date),
  estado: e.status,
  estado_meli: { status: e.status, substatus: e.substatus || '' },
  actor_name: 'MeLi',
  source: 'meli-history'
}));

function merge(existing = [], incoming = []) {
  const seen = new Set(existing.map(keyOf));
  const out = existing.slice();
  for (const h of incoming) if (!seen.has(keyOf(h))) { out.push(h); seen.add(keyOf(h)); }
  out.sort((a,b)=> new Date(a.at||0) - new Date(b.at||0));
  return out;
}

async function fetchHistory(meli_id, token) {
  const { data } = await axios.get(`https://api.mercadolibre.com/shipments/${meli_id}/history`,
    { headers: { Authorization: `Bearer ${token}` } });
  return Array.isArray(data) ? data : (data.results || []);
}

(async function main(){
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL;
  if (!uri) throw new Error('Falta MONGO_URI');
  await mongoose.connect(uri);
  console.log('[hydrate-delivered-today] conectado');

  // rango de HOY en hora local del server
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);

  // candidatos: con meli_id y con estado entregado hoy (por estado_meli.updatedAt) o por fecha del envío hoy
  const cand = await Envio.find({
    meli_id: { $ne: null },
    $or: [
      { 'estado_meli.status': 'delivered', 'estado_meli.updatedAt': { $gte: start, $lte: end } },
      { fecha: { $gte: start, $lte: end } }
    ]
  }).select('_id meli_id cliente_id historial estado_meli').lean();

  console.log(`[hydrate-delivered-today] candidatos: ${cand.length}`);

  let ok=0, fail=0;
  for (const e of cand) {
    try {
      const cli = await Cliente.findById(e.cliente_id).lean();
      if (!cli?.user_id) { console.log(' - skip no_user_id', e._id); continue; }
      const token = await getValidToken(cli.user_id);
      const raw = await fetchHistory(e.meli_id, token);
      const mapped = mapHist(raw);
      const merged = merge(e.historial || [], mapped);

      // último evento
      const last = mapped.length ? mapped.reduce((a,b)=> (a.at > b.at ? a : b)) : null;

      const set = { historial: merged, meli_history_last_sync: new Date() };
      if (last) {
        set.estado = mapToInterno(last.estado_meli?.status || last.estado, last.estado_meli?.substatus);
        set.estado_meli = {
          status: last.estado_meli?.status || last.estado,
          substatus: last.estado_meli?.substatus || null,
          updatedAt: last.at
        };
      }

      await Envio.updateOne({ _id: e._id }, { $set: set });
      console.log(` ✓ ${e.meli_id} -> ${set.estado_meli?.status || ''} @ ${set.estado_meli?.updatedAt?.toISOString() || ''}`);
      ok++;
    } catch (err) {
      console.warn(' ✗', e._id, err.response?.data || err.message);
      fail++;
    }
    await new Promise(r => setTimeout(r, 130));
  }

  console.log(`[hydrate-delivered-today] listo. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
})().catch(e => { console.error('fatal', e); process.exit(1); });
