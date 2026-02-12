#!/usr/bin/env node
require('../utils/logger');

/**
 * Hydrate MeLi history for candidate shipments.
 *
 * Ejemplo:
 *   MELI_HISTORY_DEBUG=0 node scripts/hydrate-history.js \
 *     --from=2025-09-09 --to=2025-09-20 \
 *     --autoingesta --needsync=0 \
 *     --sort=updated_desc --limit=800 --skip=0 \
 *     --force --rebuild --timefield=estado
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('[hydrate-history] FATAL: faltó MONGO_URI en variables de entorno');
  process.exit(1);
}

// Models & service
const Envio = require('../models/Envio');
const { ensureMeliHistory } = require('../services/meliHistory');

// ---------- utils ----------
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
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      args[a.slice(2)] = true;
    }
  }
  return args;
}
function toIsoDayStart(d) { return new Date(`${d}T00:00:00.000Z`); }
function toIsoDayEnd(d)   { return new Date(`${d}T23:59:59.999Z`); }

// ---------- main ----------
async function main() {
  // Conexión
  await mongoose.connect(MONGO_URI, {
    maxPoolSize: 8,
    serverSelectionTimeoutMS: 20000,
  });
  console.log('[hydrate-history] conectado a Mongo');

  const args = parseArgs(process.argv);

  // Campo para ventana temporal
  const VENTA_FIELD = 'fecha'; // <-- cambialo si tu campo de venta se llama distinto
  const timeFieldArg = String(args.timefield || '').trim().toLowerCase();
  const WINDOW_FIELD =
    timeFieldArg === 'venta'   ? VENTA_FIELD :
    timeFieldArg === 'estado'  ? 'estado_meli.updatedAt' :
    timeFieldArg === 'updated' ? 'updatedAt' :
    timeFieldArg === 'created' ? 'createdAt' :
                                 'estado_meli.updatedAt';

  // Ventana
  if (!args.from || !args.to) {
    console.error('[hydrate-history] ERROR: faltan --from y/o --to (YYYY-MM-DD)');
    process.exit(1);
  }
  const from = toIsoDayStart(args.from);
  const to   = toIsoDayEnd(args.to);

  // Flags / filtros
  const deliveredFlag = (args.delivered === undefined) ? undefined : argBool(args.delivered);
  const autoIng       = argBool(args.autoingesta, false) || argBool(args['auto_ingesta'], false);
  const poorFlag      = (args.poor === undefined ? undefined : argBool(args.poor));
  const force         = argBool(args.force, false);
  const rebuild       = argBool(args.rebuild, false);

  const needSyncHours  = (args.needsync === undefined ? null : Number(args.needsync));
  const needSyncCutoff = (needSyncHours && !Number.isNaN(needSyncHours) && needSyncHours > 0)
    ? new Date(Date.now() - needSyncHours * 3600 * 1000)
    : null;

  // Orden
  const sortArg = String(args.sort || '').trim().toLowerCase();
  const sort =
    sortArg === 'venta_asc'    ? { [VENTA_FIELD]: 1 }  :
    sortArg === 'venta_desc'   ? { [VENTA_FIELD]: -1 } :
    sortArg === 'updated_asc'  ? { [WINDOW_FIELD]: 1 } :
    sortArg === 'updated_desc' ? { [WINDOW_FIELD]: -1 } :
                                 { [WINDOW_FIELD]: -1 };

  const limit = Math.max(0, parseInt(args.limit || '300', 10));
  const skip  = Math.max(0, parseInt(args.skip  || '0',   10));

  // Filtro base
  const base = { meli_id: { $exists: true, $ne: null } };
  const filter = {
    ...base,
    [WINDOW_FIELD]: { $gte: from, $lte: to },
  };
  if (deliveredFlag === true) {
    filter['estado_meli.status'] = 'delivered';
  } else if (deliveredFlag === false) {
    filter['estado_meli.status'] = { $ne: 'delivered' };
  }
  if (autoIng) filter.autoIngesta = true;
  if (poorFlag === true)  filter['history.poor'] = true;
  if (poorFlag === false) filter['history.poor'] = { $ne: true };
  if (needSyncCutoff)     filter.updatedAt = { $lt: needSyncCutoff };

  // Diagnóstico (contadores simples y consistentes con el filtro)
  const withMeliId = await Envio.countDocuments(base);
  const inWindow   = await Envio.countDocuments({ ...base, [WINDOW_FIELD]: { $gte: from, $lte: to } });

  const fAuto   = autoIng ? { ...base, [WINDOW_FIELD]: { $gte: from, $lte: to }, autoIngesta: true } :
                            { ...base, [WINDOW_FIELD]: { $gte: from, $lte: to } };
  const afterAuto = await Envio.countDocuments(fAuto);

  const fDelivered =
    deliveredFlag === undefined ? fAuto :
    deliveredFlag ? { ...fAuto, 'estado_meli.status': 'delivered' } :
                    { ...fAuto, 'estado_meli.status': { $ne: 'delivered' } };
  const afterDelivered = await Envio.countDocuments(fDelivered);

  const fNeedSync =
    needSyncCutoff ? { ...fDelivered, updatedAt: { $lt: needSyncCutoff } } : fDelivered;
  const afterNeedSync = await Envio.countDocuments(fNeedSync);

  const fPoor =
    (poorFlag === undefined) ? fNeedSync :
    poorFlag ? { ...fNeedSync, 'history.poor': true } :
               { ...fNeedSync, 'history.poor': { $ne: true } };
  const afterPoor = await Envio.countDocuments(fPoor);

  console.log('[hydrate-history] usando meliHistory:', require.resolve('../services/meliHistory.js'), 'meliHistory.v3-sintetiza-desde-shipment');
  console.log('[hydrate-history] diagnóstico:');
  console.log(`  con meli_id: ${withMeliId}`);
  console.log(`  dentro de ventana tiempo: ${inWindow} (desde=${from.toISOString()} hasta=${to.toISOString()})`);
  console.log(`  after autoingesta: ${afterAuto}`);
  console.log(`  after delivered(${deliveredFlag === undefined ? 'sin filtro' : deliveredFlag ? 'incluye' : 'excluye'}): ${afterDelivered}`);
  console.log(`  after needsync(${needSyncHours != null ? '>'+needSyncHours+'h' : 'sin filtro'}): ${afterNeedSync}`);
  console.log(`  after poor(${poorFlag === undefined ? 'sin filtro' : poorFlag}): ${afterPoor}`);

  // Consulta final y procesamiento
  const candidatos = await Envio.find(filter).sort(sort).skip(skip).limit(limit);
  console.log(
    `[hydrate-history] candidatos: ${candidatos.length} (sort=${Object.keys(sort)[0]} ${Object.values(sort)[0] > 0 ? 'asc' : 'desc'}, ` +
    `from=${from.toISOString()}, to=${to.toISOString()}, delivered=${deliveredFlag}, poor=${poorFlag}, ` +
    `needsync=${needSyncHours != null ? needSyncHours : '(none)'}, autoingesta=${autoIng})`
  );

  let ok = 0, fail = 0;
  for (const e of candidatos) {
    try {
      // ← BUSCAR EL TENANT DEL ENVÍO
    const Tenant = require('../models/Tenant');
    const envioDoc = await Envio.findById(e._id).lean();
    const tenant = await Tenant.findById(envioDoc.tenantId);
    
    if (!tenant?.mlIntegration?.accessToken) {
      console.log(` ⚠️  ${e.meli_id || e._id} sin token ML, saltando...`);
      fail++;
      continue;
    }
      await ensureMeliHistory(e, { force, rebuild, token: tenant.mlIntegration.accessToken });


      const refreshed = await Envio.findById(e._id, { historial: 1, estado_meli: 1, meli_id: 1 }).lean();
      const hist = Array.isArray(refreshed?.historial) ? refreshed.historial : [];
      const meliEvts = hist.filter(h => (h?.source === 'meli-history') || (h?.actor_name === 'MeLi'));
      const lastEvt  = meliEvts.slice().sort((a,b)=>new Date(b.at)-new Date(a.at))[0];
      const lastTs   = refreshed?.estado_meli?.updatedAt || lastEvt?.at || null;
      const lastStatus = refreshed?.estado_meli?.status || lastEvt?.estado_meli?.status || null;

      const when = lastTs ? new Date(lastTs).toISOString() : 'null';
      console.log(` ✓ ${refreshed?.meli_id || e._id} eventos=${meliEvts.length} ${lastStatus || 'null'} @ ${when}`);
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
