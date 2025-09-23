#!/usr/bin/env node
/* scripts/repair-meli-history.js
   - Limpia duplicados MeLi
   - Prefiere fechas REALES (la más antigua) por (status, substatus)
   - Mantiene eventos NO-MeLi
   - Recalcula estado/estado_meli.updatedAt
   Usa MONGO_URI
*/
const mongoose = require('mongoose');
const path = require('path');
const minimist = require('minimist');

const Envio = require('../models/Envio');

// --- helpers (mismos criterios que el service) ---
function mapToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled' || s === 'canceled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped' || s === 'in_transit' || s === 'out_for_delivery') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling' || s === 'ready_to_print' || s === 'printed') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}
function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  const src = (h?.source || '').toLowerCase();
  return `${ts}|${mst}|${mss}|${src}`;
}
function isMeLi(h) {
  const src = (h?.source || '').toLowerCase();
  return h?.actor_name === 'MeLi' || src.startsWith('meli-history');
}

(async function main(){
  const argv = minimist(process.argv.slice(2));
  const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!MONGO) {
    console.error('[repair] FATAL: faltó MONGO_URI');
    process.exit(1);
  }
  const batch = Number(argv.limit || argv.batch || 1000);
  const from  = argv.from ? new Date(argv.from) : null;
  const to    = argv.to   ? new Date(argv.to)   : null;

  await mongoose.connect(MONGO, { maxPoolSize: 10 });
  console.log('[repair] conectado a Mongo');

  // Query: todos los que tienen meli_id. Opcionalmente filtrar por ventana de updatedAt del estado_meli
  const q = { meli_id: { $exists: true, $ne: null } };
  if (from || to) {
    q['estado_meli.updatedAt'] = {};
    if (from) q['estado_meli.updatedAt'].$gte = from;
    if (to)   q['estado_meli.updatedAt'].$lte = to;
  }

  const cursor = Envio.find(q).select({ historial: 1, estado: 1, estado_meli: 1 }).cursor();
  let n = 0, fixed = 0, skipped = 0;

  for await (const envio of cursor) {
    n++;
    const hist = Array.isArray(envio.historial) ? envio.historial.slice() : [];

    if (!hist.length) { skipped++; continue; }

    const nonMeli = hist.filter(h => !isMeLi(h));
    const meli    = hist.filter(isMeLi);

    if (!meli.length) { skipped++; continue; }

    // Agrupo por (status, substatus) y me quedo con la fecha más antigua. En empate de fecha, prefiero source con ":shipment"
    const groups = new Map();
    for (const e of meli) {
      const status = (e?.estado_meli?.status || e?.estado || '').toLowerCase();
      const sub    = (e?.estado_meli?.substatus || '').toLowerCase();
      if (!status) continue;
      const k = `${status}|${sub}`;
      const t = +new Date(e.at || e.updatedAt || 0);
      const preferShipment = String(e?.source || '').includes(':shipment');
      const cur = groups.get(k);
      if (!cur) {
        groups.set(k, { t, e, preferShipment });
      } else {
        // quedarme con la más antigua; si empatan, preferir la que viene de ":shipment"
        if (t < cur.t || (t === cur.t && (preferShipment && !cur.preferShipment))) {
          groups.set(k, { t, e, preferShipment });
        }
      }
    }

    // reconstruyo línea MeLi ordenada
    const cleanedMeli = Array.from(groups.values())
      .map(x => ({ ...x.e, at: new Date(x.t) }))
      .sort((a,b) => +new Date(a.at) - +new Date(b.at));

    // merge + dedupe por keyOf en orden cronológico
    const merged = [...nonMeli, ...cleanedMeli]
      .sort((a,b) => +new Date(a.at || a.updatedAt || 0) - +new Date(b.at || b.updatedAt || 0));

    const seen = new Set();
    const deduped = [];
    for (const h of merged) {
      const k = keyOf(h);
      if (!seen.has(k)) { seen.add(k); deduped.push(h); }
    }

    // último evento MeLi para estado
    const lastMeli = [...deduped].reverse().find(isMeLi);
    if (!lastMeli) { skipped++; continue; }

    const st  = (lastMeli?.estado_meli?.status || lastMeli?.estado || '').toString();
    const sub = (lastMeli?.estado_meli?.substatus || '').toString();

    const update = {
      $set: {
        historial: deduped,
        estado: mapToInterno(st, sub),
        estado_meli: { status: st, substatus: sub, updatedAt: lastMeli.at || new Date() },
        meli_history_last_sync: new Date()
      }
    };

    await Envio.updateOne({ _id: envio._id }, update);
    fixed++;
    if (fixed % 200 === 0) console.log(`[repair] avanzando… fixed=${fixed} / vistos=${n}`);
  }

  console.log(`[repair] listo. vistos=${n} fixed=${fixed} skipped=${skipped}`);
  await mongoose.disconnect();
})().catch(e => {
  console.error('[repair] FATAL:', e);
  process.exit(1);
});
