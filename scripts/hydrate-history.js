// scripts/hydrate-delivered-today.js
require('dotenv').config();
const mongoose = require('mongoose');
const axios    = require('axios');
const Envio    = require('../models/Envio');
const Cliente  = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

function mapToInterno(status, sub) {
  const s = (status||'').toLowerCase(), u = (sub||'').toLowerCase();
  if (s==='delivered') return 'entregado';
  if (s==='cancelled') return 'cancelado';
  if (s==='not_delivered') return /receiver[_\s-]?absent/.test(u) ? 'comprador_ausente' : 'no_entregado';
  if (s==='shipped') return 'en_camino';
  if (s==='ready_to_ship' || s==='handling') return 'pendiente';
  if (/resched/.test(u)) return 'reprogramado';
  if (/delay/.test(u))   return 'demorado';
  return 'pendiente';
}
const mapMeliHistory = (items=[]) => items.map(e => ({
  at:new Date(e.date), estado:e.status,
  estado_meli:{status:e.status, substatus:e.substatus||''},
  actor_name:'MeLi', source:'meli-history'
}));
function mergeHistorial(existing=[], incoming=[]) {
  const key = h => `${+new Date(h.at||h.updatedAt||0)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}`;
  const seen = new Set(existing.map(key));
  const out = existing.slice();
  for (const h of incoming) if (!seen.has(key(h))) { out.push(h); seen.add(key(h)); }
  out.sort((a,b)=>new Date(a.at)-new Date(b.at));
  return out;
}
async function fetchHistory(meli_id, token) {
  const { data } = await axios.get(`https://api.mercadolibre.com/shipments/${meli_id}/history`,
    { headers:{Authorization:`Bearer ${token}`} });
  return Array.isArray(data) ? data : (data.results||[]);
}
async function hydrateOne(e) {
  const cliente = await Cliente.findById(e.cliente_id).lean();
  if (!cliente?.user_id) return { skipped:true, reason:'no_user_id' };
  const token = await getValidToken(cliente.user_id);
  const mapped = mapMeliHistory(await fetchHistory(e.meli_id, token));
  const merged = mergeHistorial(e.historial||[], mapped);
  const last   = mapped.reduce((a,b)=> new Date(a.at)>new Date(b.at)?a:b, mapped[0]);
  const setBlock = { historial: merged, meli_history_last_sync:new Date() };
  if (last) {
    setBlock.estado = mapToInterno(last.estado_meli?.status||last.estado, last.estado_meli?.substatus);
    setBlock.estado_meli = { status:last.estado_meli?.status||last.estado, substatus:last.estado_meli?.substatus||null, updatedAt:last.at };
  }
  await Envio.updateOne({ _id:e._id }, { $set:setBlock });
  return { ok:true, lastAt:last?.at||null, lastStatus:last?.estado_meli?.status||last?.estado||null };
}

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL;
  if (!uri) throw new Error('Falta MONGO_URI');
  await mongoose.connect(uri);

  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);

  const envios = await Envio.find({
    meli_id: { $ne: null },
    fecha:   { $gte: start, $lte: end },
    $or: [ { estado: 'entregado' }, { 'estado_meli.status': 'delivered' } ]
  }).select('_id meli_id cliente_id historial').lean();

  console.log('[hydrate-delivered-today] candidatos:', envios.length);
  let ok=0, fail=0;
  for (const e of envios) {
    try { const r = await hydrateOne(e); if (r.ok) { ok++; console.log(' ✓', e.meli_id, r.lastStatus, '@', r.lastAt); } }
    catch (err) { fail++; console.warn(' ✗', e.meli_id, err.message); }
    await new Promise(r=>setTimeout(r,130));
  }
  console.log('[hydrate-delivered-today] listo. ok=%d fail=%d', ok, fail);
  await mongoose.disconnect();
})().catch(e => { console.error('fatal', e); process.exit(1); });
