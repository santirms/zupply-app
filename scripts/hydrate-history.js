#!/usr/bin/env node
/**
 * Hydrate MeLi history for candidate shipments.
 *
 * Uso ejemplo:
 *   MELI_HISTORY_DEBUG=0 node scripts/hydrate-history.js \
 *     --from=2025-09-09 --to=2025-09-20 \
 *     --autoingesta --needsync=0 \
 *     --sort=updated_desc --limit=800 --skip=0 \
 *     --force --rebuild --timefield=estado
 */

const mongoose = require('mongoose');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('[hydrate-history] FATAL: faltó MONGO_URI en variables de entorno');
  process.exit(1);
}

// Models & service
const Envio = require('../models/Envio');
const { ensureMeliHistory } = require('../services/meliHistory');

// ---------- utils básicos ----------
function argBool(v, def = false) {
  if (v === undefined || v === null) return !!def;
  const s = String(v).trim().toLowerCase();
  if (['1','true','yes','y','on'].includes(s)) return true;
  if (['0','false','no','n','off'].includes(s)) return false;
  return !!def;
}
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) {
      const k = a.slice(2, eq);
      const v = a.slice(eq + 1);
      args[k] = v;
    } else {
      const k = a.slice(2);
      // flags booleanas estilo --force
      args[k] = true;
    }
  }
  return args;
}
function toIsoDayStart(d) {
  return new Date(`${d}T00:00:00.000Z`);
}
function toIsoDayEnd(d) {
  return new Date(`${d}T23:59:59.999Z`);
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);

  const timeFieldArg = (args.timefield || '').toString().trim().toLowerCase();
  const timeField =
    timeFieldArg === 'estado'  ? 'estado_meli.updatedAt' :
    timeFieldArg === 'updated' ? 'updatedAt' :
    timeFieldArg === 'created' ? 'createdAt' :
    'estado_meli.updatedAt';

  const now = Date.now();
  const from = args.from ? toIsoDayStart(args.from) : new Date(0);
  const to   = args.to   ? toIsoDayEnd(args.to)     : new Date(now);

  // Por defecto INCLUYE entregados. Si --delivered=false => los excluye
  const deliveredFlag = argBool(args.delivered, true);

  // needsync: horas (si se omite => no filtra)
  const needSyncHours = (args.needsync !== undefined && args.needsync !== null && args.needsync !== '')
    ? Number(args.needsync)
    : null;
  const needSyncCutoff = needSyncHours != null
    ? new Date(now - needSyncHours * 60 * 60 * 1000)
    : null;

  const autoIng = argBool(args.autoingesta, false) || argBool(args['auto_ingesta'], false);
  const poorFlag = argBool(args.poor, false);
  const force = argBool(args.force, false);
  const rebuild = argBool(args.rebuild, false);

  // Orden
  const sortArg = (args.sort || '').toString().trim().toLowerCase();
  let sort = {};
  if (sortArg === 'updated_desc') sort = { [timeField]: -1 };
  else if (sortArg === 'updated_asc') sort = { [timeField]: 1 };
  else sort = { [timeField]: -1 }; // default

  const limit = Math.max(0, parseInt(args.limit || '300', 10));
  const skip  = Math.max(0, parseInt(args.skip  || '0', 10));

  // Conexión
  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 20000,
    maxPoolSize: 10,
  });
  console.log('[hydrate-history] conectado a Mongo');

  // --- Diagnóstico rápido base ---
  const withMeliId = await Envio.countDocuments({ meli_id: { $exists: true, $ne: null } });
  const deliveredCount = await Envio.countDocuments({ estado: 'entregado' });

  // === Build base filter ===
  const baseTime = { [timeField]: { $gte: from, $lte: to } };

  const diagCounts = {};
  diagCounts.total = await Envio.countDocuments({});
  diagCounts.inWindow = await Envio.countDocuments(baseTime);

  let filter = { ...baseTime };

  // autoingesta (si se pidió)
  if (autoIng) {
    filter = {
      $and: [
        filter,
        { $or: [{ autoingesta: true }, { auto_ingesta: true }] }
      ]
    };
  }
  diagCounts.afterAuto = await Envio.countDocuments(filter);

  // delivered (si se pidió excluir)
  if (!deliveredFlag) {
    filter = { $and: [ filter, { estado: { $ne: 'entregado' } } ] };
  }
  diagCounts.afterDelivered = await Envio.countDocuments(filter);

  // needsync (si se especificó)
  if (needSyncHours != null) {
    const needSyncFilter = {
      $or: [
        { meli_history_last_sync: { $exists: false } },
        { meli_history_last_sync: { $lte: needSyncCutoff } }
      ]
    };
    filter = { $and: [ filter, needSyncFilter ] };
  }
  diagCounts.afterNeedSync = await Envio.countDocuments(filter);

  // poor (opcional, default false)
  if (poorFlag) {
    filter = {
      $and: [
        filter,
        { $or: [
          { historial: { $exists: false } },
          { $expr: { $lt: [ { $size: { $ifNull: [ "$historial", [] ] } }, 2 ] } }
        ] }
      ]
    };
  }
  diagCounts.afterPoor = await Envio.countDocuments(filter);

  // Candidatos
  const candidatos = await Envio
    .find(filter, { historial: 0 }) // no traemos historial aquí para ahorrar red
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  // Print diagnóstico
  console.log('[hydrate-history] usando meliHistory:', require.resolve('../services/meliHistory'), 'meliHistory.v3-sintetiza-desde-shipment');
  console.log('[hydrate-history] diagnóstico:');
  console.log(`  con meli_id: ${withMeliId}`);
  console.log(`  dentro de ventana tiempo: ${diagCounts.inWindow} (desde=${from.toISOString()} hasta=${to.toISOString()})`);
  console.log(`  estado=entregado: ${deliveredCount}`);
  console.log(`  after autoingesta: ${diagCounts.afterAuto}`);
  console.log(`  after delivered(${deliveredFlag ? 'incluye' : 'excluye'}): ${diagCounts.afterDelivered}`);
  if (needSyncHours != null) {
    console.log(`  after needsync(>${needSyncHours}h): ${diagCounts.afterNeedSync}`);
  } else {
    console.log('  needsync: (sin filtro)');
    console.log(`  after needsync: ${diagCounts.afterNeedSync}`);
  }
  console.log(`  after poor(${poorFlag}): ${diagCounts.afterPoor}`);

  console.log(
    `[hydrate-history] candidatos: ${candidatos.length} ` +
    `(sort=${Object.keys(sort)[0]} ${Object.values(sort)[0] > 0 ? 'asc' : 'desc'}, ` +
    `from=${from.toISOString()}, to=${to.toISOString()}, ` +
    `delivered=${deliveredFlag}, poor=${poorFlag}, ` +
    `needsync=${needSyncHours != null ? needSyncHours : '(none)'}, autoingesta=${autoIng})`
  );

  let ok = 0, fail = 0;

  for (const e of candidatos) {
    try {
      // hidratamos
      await ensureMeliHistory(e, { force, rebuild });

      // volvemos a leer solo para poder reportar
      const refreshed = await Envio.findById(e._id, { historial: 1, estado_meli: 1 }).lean();
      const hist = Array.isArray(refreshed?.historial) ? refreshed.historial : [];
      const meliEvts = hist.filter(h => (h?.source === 'meli-history') || (h?.actor_name === 'MeLi'));
      const lastTs = refreshed?.estado_meli?.updatedAt || meliEvts.slice().sort((a,b)=>new Date(b.at)-new Date(a.at))[0]?.at || null;

      const when = lastTs ? new Date(lastTs).toISOString() : 'null';
      const lastStatus = refreshed?.estado_meli?.status || (meliEvts.slice().sort((a,b)=>new Date(b.at)-new Date(a.at))[0]?.estado_meli?.status) || null;
      console.log(` ✓ ${e.meli_id || e._id} eventos=${meliEvts.length} ${lastStatus || 'null'} @ ${when}`);
      ok++;
    } catch (err) {
      console.log(` ✗ ${e.meli_id || e._id} error=${err?.message || err}`);
      fail++;
    }
  }

  console.log(`[hydrate-history] listo. ok=${ok} fail=${fail}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[hydrate-history] FATAL:', err?.stack || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
