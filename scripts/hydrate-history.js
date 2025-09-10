// scripts/hydrate-history.js
// Rellena historial desde /shipments/{id}/history con hora REAL de MeLi.
// Uso:
//   node scripts/hydrate-history.js --hours=24
//   node scripts/hydrate-history.js --since=2025-09-09
//   node scripts/hydrate-history.js --meli=45479638673

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// Models & utils de tu proyecto
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

// ------- helpers CLI -------
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k,v='true'] = a.replace(/^--?/,'').split('=');
    return [k, v];
  })
);

const HOURS = Number(args.hours || 24);
const SINCE = args.since ? new Date(args.since) : null;
const ONE   = args.meli || args.meli_id || null;

// ------- mapping/merge -------
function mapToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();

  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'not_delivered') {
    if (/receiver[_\s-]?absent/.test(sub)) return 'comprador_ausente';
    return 'no_entregado';
  }
  if (s === 'shipped') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}

function mapMeliHistory(items = []) {
  return items.map(e => ({
    at: new Date(e.date), // hora real
    estado: e.status,
    estado_meli: { status: e.status, substatus: e.substatus || '' },
    actor_name: 'MeLi',
    source: 'meli-history',
  }));
}

function mergeHistorial(existing = [], incoming = []) {
  const key = h =>
    `${+new Date(h.at || h.updatedAt || 0)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}`;
  const seen = new Set(existing.map(key));
  const out = existing.slice();
  for (const h of incoming) {
    const k = key(h);
    if (!seen.has(k)) {
      out.push(h);
      seen.add(k);
    }
  }
  out.sort((a,b)=> new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0));
  return out;
}

async function fetchHistory(meli_id, token) {
  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${meli_id}/history`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return Array.isArray(data) ? data : (data.results || []);
}

async function hydrateOne(envio) {
  try {
    const cliente = await Cliente.findById(envio.cliente_id).lean();
    if (!cliente?.user_id) return { skipped: true, reason: 'no_user_id' };

    const token = await getValidToken(cliente.user_id);
    const raw   = await fetchHistory(envio.meli_id, token);
    const mapped = mapMeliHistory(raw);

    // merge con lo existente
    const merged = mergeHistorial(envio.historial || [], mapped);

    // último evento para “promocionar” a estado/estado_meli.updatedAt
    const last = mapped.length
      ? mapped.reduce((a,b)=> (new Date(a.at) > new Date(b.at) ? a : b))
      : null;

    const setBlock = {
      historial: merged,
      meli_history_last_sync: new Date(),
    };

    if (last) {
      setBlock.estado = mapToInterno(last.estado_meli?.status || last.estado, last.estado_meli?.substatus);
      setBlock.estado_meli = {
        status:    last.estado_meli?.status || last.estado,
        substatus: last.estado_meli?.substatus || null,
        updatedAt: last.at ? new Date(last.at) : new Date(),
      };
    }

    // updateOne evita validación de required (p.ej., id_venta ausente)
    await Envio.updateOne({ _id: envio._id }, { $set: setBlock }).lean();

    return { ok: true, lastAt: last?.at || null, lastStatus: last?.estado_meli?.status || last?.estado || null };
  } catch (err) {
    return { ok: false, error: err.response?.data || err.message };
  }
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL;
  if (!uri) throw new Error('Falta MONGODB_URI');

  await mongoose.connect(uri);
  console.log('[hydrate-history] conectado a Mongo');

  let query;
  if (ONE) {
    query = { meli_id: String(ONE) };
    console.log(`[hydrate-history] Modo unitario meli_id=${ONE}`);
  } else {
    let since = SINCE || new Date();
    since.setHours(since.getHours() - (SINCE ? 0 : HOURS), 0, 0, 0);
    console.log(`[hydrate-history] Buscando envíos desde ${since.toISOString()}`);

    query = {
      meli_id: { $ne: null },
      fecha:   { $gte: since },
    };
  }

  const envios = await Envio.find(query)
    .select('_id meli_id cliente_id historial')
    .limit(2000)
    .lean();

  console.log(`[hydrate-history] candidatos: ${envios.length}`);

  let ok = 0, fail = 0;
  for (const e of envios) {
    const r = await hydrateOne(e);
    if (r.ok) {
      ok++;
      console.log(`  ✓ ${e.meli_id} ${r.lastStatus || ''} @ ${r.lastAt || ''}`);
    } else if (r.skipped) {
      console.log(`  – ${e.meli_id} skip: ${r.reason}`);
    } else {
      fail++;
      console.warn(`  ✗ ${e.meli_id} ${r.error}`);
    }
    await new Promise(r => setTimeout(r, 130)); // rate-limit suave
  }

  console.log(`[hydrate-history] listo. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[hydrate-history] fatal:', err);
  process.exit(1);
});
