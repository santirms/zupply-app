// scripts/hydrate-history.js
/* eslint-disable no-console */
const mongoose = require('mongoose');
const path = require('path');

// Models & services
const Envio = require('../models/Envio');
const meliHistory = require('../services/meliHistory');

// ===== Util =====
function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, vRaw] = a.replace(/^--/, '').split('=');
      const v = (vRaw === undefined) ? true : vRaw;
      args[k] = v;
    }
  }
  return args;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function asDateOrNull(s, end = false) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(+d)) return null;
  return end ? endOfDay(d) : startOfDay(d);
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function timeFieldPath(which) {
  // --timefield=estado → usa estado_meli.updatedAt
  // default → updatedAt (document-level)
  if (`${which}`.toLowerCase() === 'estado') return 'estado_meli.updatedAt';
  return 'updatedAt';
}

function sortSpec(sortArg, tfPath) {
  // ejemplos: updated_desc, updated_asc, estado_desc, estado_asc
  const s = (sortArg || '').toLowerCase();
  if (s.endsWith('_asc'))  return { [tfPath]: 1 };
  if (s.endsWith('_desc')) return { [tfPath]: -1 };
  // default
  return { [tfPath]: -1 };
}

// ===== Main =====
(async function main() {
  const args = parseArgs();

  const FROM = asDateOrNull(args.from);
  const TO   = asDateOrNull(args.to, true);

  const TIMEFIELD = timeFieldPath(args.timefield); // 'estado' o 'updated'
  const NEEDSYNC_HOURS = toInt(args.needsync, 0);
  const LIMIT = toInt(args.limit, 300);
  const SKIP  = toInt(args.skip, 0);
  const FORCE = !!args.force;
  const REBUILD = !!args.rebuild;

  const AUTOINGESTA = !!args.autoingesta;
  const DELIVERED_FLAG = (args.delivered ?? 'false'); // solo para imprimir

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('[hydrate-history] FATAL: faltó MONGO_URI en el entorno');
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    maxPoolSize: 5,
  });

  console.log('[hydrate-history] conectado a Mongo');
  console.log('[hydrate-history] usando meliHistory:', require.resolve('../services/meliHistory'), meliHistory.VERSION || 'sin VERSION');

  // ---- métricas de diagnóstico ----
  const withMeliIdCount = await Envio.countDocuments({ meli_id: { $exists: true, $ne: null } });

  const timeWindowFilter = {};
  if (FROM) timeWindowFilter[TIMEFIELD] = { ...(timeWindowFilter[TIMEFIELD] || {}), $gte: FROM };
  if (TO)   timeWindowFilter[TIMEFIELD] = { ...(timeWindowFilter[TIMEFIELD] || {}), $lte: TO };

  const inWindowCount = Object.keys(timeWindowFilter).length
    ? await Envio.countDocuments({ meli_id: { $exists: true, $ne: null }, ...timeWindowFilter })
    : 0;

  const deliveredCount = await Envio.countDocuments({ estado: 'entregado' });

  let needSyncCount = 0;
  if (NEEDSYNC_HOURS > 0) {
    const cutoff = new Date(Date.now() - NEEDSYNC_HOURS * 3600 * 1000);
    needSyncCount = await Envio.countDocuments({
      meli_id: { $exists: true, $ne: null },
      $or: [
        { meli_history_last_sync: { $exists: false } },
        { meli_history_last_sync: { $lt: cutoff } },
      ],
    });
  } else {
    // si needsync=0, mostramos cuántos tienen algún last_sync (o no) solo a modo informativo
    needSyncCount = await Envio.countDocuments({ meli_id: { $exists: true, $ne: null } });
  }

  console.log('[hydrate-history] diagnóstico:');
  console.log('  con meli_id:', withMeliIdCount);
  if (FROM || TO) {
    console.log('  dentro de ventana tiempo:', inWindowCount, `(desde=${FROM ? FROM.toISOString() : '-'} hasta=${TO ? TO.toISOString() : '-'})`);
  }
  console.log('  estado=entregado:', deliveredCount);
  console.log('  necesita sync (>0h):', needSyncCount);

  // ---- query base de candidatos ----
  const base = { meli_id: { $exists: true, $ne: null } };

  if (AUTOINGESTA) base.autoingesta = true;

  // Si el caller quiere excluir entregados (como en tus ejecuciones previas), no incluyas 'entregado'
  if (`${DELIVERED_FLAG}` === 'false') {
    base.estado = { $ne: 'entregado' };
  }

  // window por timefield (updatedAt o estado_meli.updatedAt)
  Object.assign(base, timeWindowFilter);

  // needsync (si >0): refrescar los que tengan sync viejo
  if (NEEDSYNC_HOURS > 0) {
    const cutoff = new Date(Date.now() - NEEDSYNC_HOURS * 3600 * 1000);
    base.$or = [
      { meli_history_last_sync: { $exists: false } },
      { meli_history_last_sync: { $lt: cutoff } },
    ];
  }

  const sSpec = sortSpec(args.sort, TIMEFIELD);

  const candidatosCount = await Envio.countDocuments(base);
  console.log(
    `[hydrate-history] candidatos: ${candidatosCount} (sort=${Object.keys(sSpec)[0]} ${sSpec[Object.keys(sSpec)[0]] > 0 ? 'asc' : 'desc'}, from=${FROM ? FROM.toISOString() : '-'}, to=${TO ? TO.toISOString() : '-'}, delivered=${DELIVERED_FLAG}, poor=false, needsync=${NEEDSYNC_HOURS}, autoingesta=${AUTOINGESTA})`
  );

  const cursor = Envio.find(base).sort(sSpec).skip(SKIP).limit(LIMIT).cursor();

  let ok = 0, fail = 0;
  for await (const envio of cursor) {
    try {
      // hidrata
      await meliHistory.ensureMeliHistory(envio, { force: FORCE, rebuild: REBUILD });

      // lee lo recién guardado para log honesto
      const fresh = await Envio.findById(envio._id).select('historial estado estado_meli meli_id').lean();

      const eventosMeli = (fresh?.historial || []).filter((h) => h?.source === 'meli-history').length;
      const lastEvt = (fresh?.historial || [])
        .filter((h) => h?.source === 'meli-history')
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];

      const lastAt = lastEvt?.at || fresh?.estado_meli?.updatedAt || null;
      const lastSt = fresh?.estado_meli?.status || fresh?.estado || null;

      console.log(
        ` ✓ ${fresh?.meli_id || envio.meli_id} eventos=${eventosMeli} ${lastSt || 'null'} @ ${lastAt ? new Date(lastAt).toISOString() : 'null'}`
      );
      ok++;
    } catch (e) {
      console.log(` ✗ ${envio?.meli_id || envio?._id} error=${e?.message || e}`);
      fail++;
    }
  }

  console.log(`[hydrate-history] listo. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('[hydrate-history] FATAL:', err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
