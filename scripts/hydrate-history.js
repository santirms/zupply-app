// scripts/hydrate-history.js (versión diagnóstica)
// Uso ejemplos:
//   node scripts/hydrate-history.js --all --limit=500 --force
//   node scripts/hydrate-history.js --hours=48 --poor --limit=300
//   node scripts/hydrate-history.js --since=2025-09-01 --delivered --needsync=6 --force
//   MELI_HISTORY_DEBUG=1 node scripts/hydrate-history.js --all --limit=100 --force
//
// Flags:
//   --all           Ignora ventana de tiempo (trae por condiciones no temporales)
//   --hours=N       Ventana hacia atrás en horas (default 24)
//   --since=YYYY-MM-DD   Fecha desde (UTC) alternativa a --hours
//   --limit=N       Máximo candidatos (default 1000)
//   --force         Ignora TTL interno del servicio
//   --delivered     Solo envíos con estado interno 'entregado'
//   --poor          Solo envíos con historial pobre (no array o length < 2)
//   --needsync=H    Solo envíos con meli_history_last_sync ausente o más viejo que H horas
//
// Requisitos: .env con MONGODB_URI

require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const { ensureMeliHistory } = require('../services/meliHistory');

// ... arriba de todo (mantener helpers existentes)
function getFlag(name, defVal = undefined) {
  const arg = process.argv.find(a => a.startsWith(`--${name}`));
  if (!arg) return defVal;
  const [, val] = arg.split('=');
  if (val === undefined) return true;
  const num = Number(val);
  return Number.isNaN(num) ? val : num;
}

function isoOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(+d) ? null : d;
}

(async function main() {
// ... dentro del main()
const ALL        = !!getFlag('all', false);
const HOURS      = getFlag('hours', 24);
const SINCE_RAW  = getFlag('since', null);
const FROM_RAW   = getFlag('from', null);     // YYYY-MM-DD
const TO_RAW     = getFlag('to', null);       // YYYY-MM-DD
const LIMIT      = getFlag('limit', 1000);
const FORCE      = !!getFlag('force', false);
const DELIVERED  = !!getFlag('delivered', false);
const POOR       = !!getFlag('poor', false);
const NEEDSYNC_H = getFlag('needsync', null);
const AUTOINGESTA= !!getFlag('autoingesta', false);

const SORT = (getFlag('sort', 'updated_desc') || '').toLowerCase();
function sortSpec(key) {
  switch (key) {
    case 'updated_asc':  return { updatedAt:  1 };
    case 'created_desc': return { createdAt: -1 };
    case 'created_asc':  return { createdAt:  1 };
    case 'sync_asc':     return { meli_history_last_sync:  1 };
    case 'sync_desc':    return { meli_history_last_sync: -1 };
    case 'updated_desc':
    default:             return { updatedAt: -1 };
  }
}

// Rango temporal explícito
let fromDate = isoOrNull(FROM_RAW);
let toDate   = isoOrNull(TO_RAW);
let since    = null;

if (!ALL && !fromDate && !toDate) {
  if (SINCE_RAW) {
    since = isoOrNull(SINCE_RAW);
    if (!since) {
      console.error('[hydrate-history] ERROR: --since inválido (use YYYY-MM-DD)'); process.exit(1);
    }
  } else {
    since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  }
}


  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000
    });
    console.log('[hydrate-history] conectado a Mongo');
  } catch (err) {
    console.error('[hydrate-history] ERROR conectando a Mongo:', err?.message);
    process.exit(1);
  }

  // -----------------------------------------------
  // Construcción del query base (diagnóstico amigable)
  // -----------------------------------------------
  const mustHave = { meli_id: { $exists: true, $ne: null, $ne: '' } };

  // Condiciones OR por tiempo (si NO --all)
 const timeOr = [];
if (!ALL && since) {
  timeOr.push({ updatedAt: { $gte: since } }, { createdAt: { $gte: since } });
}

  // Condición "poor" (historial pobre)
  const poorCond = {
    $or: [
      { historial: { $exists: false } },
      { historial: { $type: 'array', $size: 0 } },
      { historial: { $exists: true }, $where: 'Array.isArray(this.historial) && this.historial.length < 2' }
    ]
  };

  // --- decidir si aplicar la compuerta temporal ---
const HAS_STRONG_FILTER = DELIVERED || POOR || (NEEDSYNC_H != null);
  
  // Condición "needsync"
  let needSyncCond = null;
  if (NEEDSYNC_H != null) {
    const cutoff = new Date(Date.now() - Number(NEEDSYNC_H) * 60 * 60 * 1000);
    needSyncCond = {
      $or: [
        { meli_history_last_sync: { $exists: false } },
        { meli_history_last_sync: { $lt: cutoff } }
      ]
    };
  }

 // Armar $and final
const andParts = [mustHave];

// SOLO aplicamos la compuerta temporal si NO hay filtros fuertes
if (!ALL && timeOr.length && !HAS_STRONG_FILTER) {
  andParts.push({ $or: timeOr });
}

if (DELIVERED) andParts.push({ estado: 'entregado' });
if (POOR) andParts.push(poorCond);
if (needSyncCond) andParts.push(needSyncCond);

const query = andParts.length > 1 ? { $and: andParts } : mustHave;

  // -----------------------------------------------
  // Diagnóstico rápido de conteos
  // -----------------------------------------------
  try {
    const countAllWithId = await Envio.countDocuments(mustHave);
    const countTime = !ALL && timeOr.length ? await Envio.countDocuments({ $and: [mustHave, { $or: timeOr }] }) : null;
    const countDelivered = DELIVERED ? await Envio.countDocuments({ $and: [mustHave, { estado: 'entregado' }] }) : null;
    const countPoor = POOR ? await Envio.countDocuments({ $and: [mustHave, poorCond] }) : null;
    const countNeedSync = needSyncCond ? await Envio.countDocuments({ $and: [mustHave, needSyncCond] }) : null;

    console.log('[hydrate-history] diagnóstico:');
    console.log(`  con meli_id: ${countAllWithId}`);
    if (countTime !== null)      console.log(`  dentro de ventana tiempo: ${countTime} (desde=${since?.toISOString?.() || 'n/a'})`);
    if (countDelivered !== null) console.log(`  estado=entregado: ${countDelivered}`);
    if (countPoor !== null)      console.log(`  historial pobre: ${countPoor}`);
    if (countNeedSync !== null)  console.log(`  necesita sync (>${NEEDSYNC_H}h): ${countNeedSync}`);
  } catch (err) {
    console.warn('[hydrate-history] aviso: no se pudieron calcular todos los conteos:', err?.message);
  }

  // -----------------------------------------------
  // Buscar candidatos
  // -----------------------------------------------
 let candidatos = [];
try {
  candidatos = await Envio
    .find(query)
    .select('_id meli_id cliente_id historial estado updatedAt createdAt meli_history_last_sync')
    .sort(sortSpec(SORT))        // <<— updated_desc por defecto
    .limit(LIMIT)
    .lean();

  console.log(`[hydrate-history] candidatos: ${candidatos.length} (sort=${SORT}, from=${fromDate?.toISOString?.()||'n/a'}, to=${toDate?.toISOString?.()||'n/a'}, delivered=${DELIVERED}, poor=${POOR}, needsync=${NEEDSYNC_H ?? 'n/a'}, autoingesta=${AUTOINGESTA})`);
} catch (err) {
  console.error('[hydrate-history] ERROR buscando candidatos:', err?.message);
  process.exit(1);
}

  // Si no hay candidatos, sugerir banderas útiles
  if (!candidatos.length) {
    console.log('[hydrate-history] SUGERENCIA: probá alguna de estas variantes:');
    console.log('  - node scripts/hydrate-history.js --all --limit=200 --force');
    console.log('  - node scripts/hydrate-history.js --poor --hours=240 --limit=200 --force');
    console.log('  - node scripts/hydrate-history.js --delivered --hours=72 --needsync=6 --force');
  }

  let ok = 0, fail = 0;

  // Procesar secuencialmente
  for (const envio of candidatos) {
    try {
      await ensureMeliHistory(envio._id, { force: FORCE });

      const refreshed = await Envio.findById(envio._id).select('historial estado estado_meli').lean();
      const hist = Array.isArray(refreshed?.historial) ? refreshed.historial : [];
      const len = hist.length;

      let lastStr = 'null @ null';
      if (len > 0) {
        const lastEvt = hist.slice().sort((a,b) => new Date(b.at || b.updatedAt || 0) - new Date(a.at || a.updatedAt || 0))[0];
        const s  = lastEvt?.estado_meli?.status || lastEvt?.estado || '';
        const ss = lastEvt?.estado_meli?.substatus || '';
        const at = lastEvt?.at || lastEvt?.updatedAt || null;
        lastStr = `${s}${ss ? '/' + ss : ''} @ ${at ? new Date(at).toISOString() : 'null'}`;
      }

      console.log(` ✓ ${envio.meli_id} eventos=${len}  ${lastStr}`);
      ok++;
    } catch (err) {
      console.log(` ✗ ${envio.meli_id} error=${err?.message || err}`);
      fail++;
    }
  }

  console.log(`[hydrate-history] listo. ok=${ok} fail=${fail}`);

  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(0);
})().catch(e => {
  console.error('[hydrate-history] FATAL:', e);
  process.exit(1);
});
