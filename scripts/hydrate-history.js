// scripts/hydrate-history.js
// Uso:
//   node scripts/hydrate-history.js --hours=24 --limit=500 --force
//   MELI_HISTORY_DEBUG=1 node scripts/hydrate-history.js --hours=12 --delivered
//
// Flags:
//   --hours      Ventana de tiempo hacia atrás (default 24)
//   --limit      Máximo de candidatos a procesar (default 1000)
//   --force      Ignora el TTL interno del servicio y fuerza la hidratación
//   --delivered  Filtra envíos con estado interno 'entregado' dentro de la ventana
//
// Requisitos:
//   - process.env.MONGODB_URI debe estar configurado
//   - services/meliHistory.ensureMeliHistory disponible

require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const { ensureMeliHistory } = require('../services/meliHistory');

function getFlag(name, defVal = undefined) {
  const arg = process.argv.find(a => a.startsWith(`--${name}`));
  if (!arg) return defVal;
  const [, val] = arg.split('=');
  if (val === undefined) return true; // flag sin valor => booleano
  const num = Number(val);
  return Number.isNaN(num) ? val : num;
}

(async function main() {
  const HOURS     = getFlag('hours', 24);
  const LIMIT     = getFlag('limit', 1000);
  const FORCE     = !!getFlag('force', false);
  const DELIVERED = !!getFlag('delivered', false);

  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);

  if (!process.env.MONGO_URI) {
    console.error('[hydrate-history] ERROR: faltante MONGO_URI en .env');
    process.exit(1);
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

  // Query base: envíos con meli_id y actividad reciente (createdAt o updatedAt)
  const baseQuery = {
    meli_id: { $exists: true, $ne: null },
    $or: [
      { updatedAt: { $gte: since } },
      { createdAt: { $gte: since } }
    ]
  };

  // Si piden sólo entregados en la ventana
  if (DELIVERED) {
    baseQuery.estado = 'entregado';
  }

  let candidatos = [];
  try {
    candidatos = await Envio
      .find(baseQuery)
      .select('_id meli_id cliente_id historial estado updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .limit(LIMIT)
      .lean();

    console.log(`[hydrate-history] candidatos: ${candidatos.length} (hours=${HOURS}, delivered=${DELIVERED})`);
  } catch (err) {
    console.error('[hydrate-history] ERROR buscando candidatos:', err?.message);
    process.exit(1);
  }

  let ok = 0, fail = 0;

  // Procesar secuencial para no pegarle muy fuerte a la API
  for (const envio of candidatos) {
    try {
      await ensureMeliHistory(envio._id, { force: FORCE });

      // Volver a leer historial para informar cantidad real tras hidratar
      const refreshed = await Envio.findById(envio._id).select('historial estado estado_meli').lean();
      const hist = Array.isArray(refreshed?.historial) ? refreshed.historial : [];
      const len = hist.length;

      // Compute último evento (si hay)
      let lastStr = 'null @ null';
      if (len > 0) {
        const lastEvt = hist.slice().sort((a, b) => new Date(b.at || b.updatedAt || 0) - new Date(a.at || a.updatedAt || 0))[0];
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

  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(0);
})().catch(e => {
  console.error('[hydrate-history] FATAL:', e);
  process.exit(1);
});
