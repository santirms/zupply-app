// scripts/hydrate-history.js
/* eslint-disable no-console */
require('dotenv').config();

const mongoose = require('mongoose');
const minimist = require('minimist');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { ensureMeliHistory } = require('../services/meliHistory');
const meliHistory = require('../services/meliHistory');
console.log('[hydrate-history] usando meliHistory:', require.resolve('../services/meliHistory'), meliHistory.VERSION||'sin VERSION');

// --------- helpers flags ----------
const argv = minimist(process.argv.slice(2));

const getFlag = (name, def = false) => {
  if (argv[name] === undefined) return def;
  const v = argv[name];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'y'].includes(v.toLowerCase());
  return !!v;
};
const getNum = (name, def = null) => {
  const v = argv[name];
  if (v === undefined || v === null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const getStr = (name, def = null) => {
  const v = argv[name];
  if (v === undefined || v === null) return def;
  return String(v);
};

const isoOrNull = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(+d) ? d : null;
};

// --------- flags ----------
const ALL          = getFlag('all', false);
const POOR         = getFlag('poor', false);
const DELIVERED    = getFlag('delivered', false);
const AUTOINGESTA  = getFlag('autoingesta', false);
const FORCE        = getFlag('force', false);
const REBUILD      = getFlag('rebuild', false);

const HOURS        = getNum('hours', null);          // ej --hours=72  (ventana tiempo relativa)
const NEEDSYNC_H   = getNum('needsync', null);       // ej --needsync=6 (re-sync si >6h)
const LIMIT        = getNum('limit', 200);
const SKIP         = getNum('skip', 0);
const SORT         = getStr('sort', 'updated_desc'); // updated_desc | updated_asc | created_desc | created_asc

const FROM_RAW     = getStr('from', null);           // ej --from=2025-09-09
const TO_RAW       = getStr('to', null);             // ej --to=2025-09-20

// --------- mongo uri ----------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[hydrate-history] FATAL: faltante env MONGO_URI');
  process.exit(1);
}

// --------- main ----------
async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('[hydrate-history] conectado a Mongo');

  // fechas (rango absoluto)
  let fromDate = isoOrNull(FROM_RAW);
  let toDate   = isoOrNull(TO_RAW);
  // extender 'to' al fin del día (23:59:59.999)
  if (toDate) toDate = new Date(toDate.getTime() + (24 * 60 * 60 * 1000 - 1));

  // si dan --hours, sobreescribe ventana (desde ahora - HOURS)
  if (HOURS && Number.isFinite(HOURS)) {
    fromDate = new Date(Date.now() - HOURS * 60 * 60 * 1000);
    toDate = null; // ventana abierta hasta ahora
  }

  // query base
  const q = { meli_id: { $exists: true, $ne: null } };

// ---- OR de fechas: incluir también estado_meli.updatedAt ----
const timeOr = [];
if (fromDate || toDate) {
  const range = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate)   range.$lte = toDate;
  // considerar timestamps del doc y el del último estado MeLi
  timeOr.push(
    { updatedAt: range },
    { createdAt: range },
    { 'estado_meli.updatedAt': range }   // 👈 clave para tu caso
  );
}
if (timeOr.length) q.$or = timeOr;

  if (!ALL) {
    // delivered filter
    if (DELIVERED) q.estado = 'entregado';

    // poor history (<2 eventos) => historial inexistente o sólo 0/1 elemento
    if (POOR) {
      q.$and = (q.$and || []).concat([
        { $or: [{ historial: { $exists: false } }, { 'historial.1': { $exists: false } }] }
      ]);
    }

    // needsync (> X horas) o nunca sincronizado
    if (NEEDSYNC_H !== null) {
      const cutoff = new Date(Date.now() - NEEDSYNC_H * 60 * 60 * 1000);
      q.$and = (q.$and || []).concat([
        { $or: [{ meli_history_last_sync: { $lt: cutoff } }, { meli_history_last_sync: { $exists: false } }] }
      ]);
    }
  }

  // autoingesta (filtra por clientes con auto_ingesta=true)
  if (AUTOINGESTA) {
    const cs = await Cliente.find({ auto_ingesta: true }).select('_id').lean();
    const ids = cs.map(c => c._id);
    // si no hay clientes con auto_ingesta, deja query imposible para no procesar nada
    q.cliente_id = ids.length ? { $in: ids } : { $in: [] };
  }

  // diagnóstico rápido
  const countWithMeliId = await Envio.countDocuments({ meli_id: { $exists: true, $ne: null } });
  const countDelivered  = await Envio.countDocuments({ meli_id: { $exists: true, $ne: null }, estado: 'entregado' });
  let countNeedSync = 0;
  if (NEEDSYNC_H !== null) {
    const cutoff = new Date(Date.now() - NEEDSYNC_H * 60 * 60 * 1000);
    countNeedSync = await Envio.countDocuments({
      meli_id: { $exists: true, $ne: null },
      $or: [{ meli_history_last_sync: { $lt: cutoff } }, { meli_history_last_sync: { $exists: false } }]
    });
  }

  console.log('[hydrate-history] diagnóstico:');
  console.log('  con meli_id:', countWithMeliId);
if (fromDate || toDate) {
  const base = { meli_id: { $exists: true, $ne: null } };
  if (AUTOINGESTA) {
    const cs = await Cliente.find({ auto_ingesta: true }).select('_id').lean();
    const ids = cs.map(c => c._id);
    base.cliente_id = ids.length ? { $in: ids } : { $in: [] };
  }
  const countInWindow = await Envio.countDocuments({
    ...base,
    ...(timeOr.length ? { $or: timeOr } : {})
  });
  console.log('  dentro de ventana tiempo:', countInWindow,
    `(desde=${fromDate ? fromDate.toISOString() : 'n/a'} hasta=${toDate ? toDate.toISOString() : 'n/a'})`
  );
}
  console.log('  estado=entregado:', countDelivered);
  if (NEEDSYNC_H !== null) console.log(`  necesita sync (>${NEEDSYNC_H}h):`, countNeedSync);

  // sort
  let sortStage = { updatedAt: -1 };
  if (SORT === 'updated_asc') sortStage = { updatedAt: 1 };
  else if (SORT === 'created_desc') sortStage = { createdAt: -1 };
  else if (SORT === 'created_asc') sortStage = { createdAt: 1 };

  // candidatos
  const candidatos = await Envio.find(q)
    .sort(sortStage)
    .skip(SKIP)
    .limit(LIMIT)
    .select('_id meli_id estado estado_meli updatedAt cliente_id historial')
    .lean();

  console.log(
    `[hydrate-history] candidatos: ${candidatos.length} (sort=${SORT}, from=${fromDate?.toISOString?.() || 'n/a'}, to=${toDate?.toISOString?.() || 'n/a'}, delivered=${DELIVERED}, poor=${POOR}, needsync=${NEEDSYNC_H ?? 'n/a'}, autoingesta=${AUTOINGESTA})`
  );

  if (!candidatos.length) {
    console.log('[hydrate-history] listo. ok=0 fail=0');
    await mongoose.disconnect();
    process.exit(0);
  }

  let ok = 0, fail = 0;

  for (const e of candidatos) {
    try {
      await ensureMeliHistory(e._id, { force: FORCE, rebuild: REBUILD });

      // Volver a leer para reportar "eventos=" y último estado
      const refreshed = await Envio.findById(e._id).select('historial estado_meli').lean();
      const hist = Array.isArray(refreshed?.historial) ? refreshed.historial : [];
      const eventosMeli = hist.filter(h => h?.actor_name === 'MeLi' || h?.source === 'meli-history').length;

      const last = (hist.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0]) || null;
      const st = refreshed?.estado_meli?.status || last?.estado_meli?.status || last?.estado || null;
      const sub = refreshed?.estado_meli?.substatus || last?.estado_meli?.substatus || null;
      const ts = last?.at ? new Date(last.at).toISOString() : null;

      console.log(
        ` ✓ ${e.meli_id} eventos=${eventosMeli} ${st || 'null'}${sub ? '/' + sub : ''} @ ${ts || 'null'}`
      );
      ok++;
    } catch (err) {
      console.log(` ✗ ${e.meli_id} error=${err?.message || err}`);
      fail++;
    }
  }

  console.log(`[hydrate-history] listo. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('[hydrate-history] FATAL:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
