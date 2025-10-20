require('../utils/logger');
// scripts/runSyncPending.js
require('dotenv').config();
const mongoose = require('mongoose');

// Registrar modelos ANTES de usarlos (¡ojo con la caja del nombre del archivo!)
require('../models/listaDePrecios');
require('../models/Cliente');
require('../models/Envio');
try { require('../models/Zona'); } catch (_) {} // si existe
require('../models/partidos');

const { syncPendingShipments } = require('../services/meliSync');

(async () => {
  try {
    // acepta MONGO_URI, MONGODB_URI o DATABASE_URL (en ese orden)
    const uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL;

    if (!uri) {
      console.error('[cron] FALTA URI: defina MONGO_URI o MONGODB_URI o DATABASE_URL');
      process.exit(1);
    }

    const opt = {};
    const dbName = process.env.MONGODB_DB || process.env.MONGO_DB;
    if (dbName) opt.dbName = dbName;

    await mongoose.connect(uri, opt);
    console.log('[cron] Conectado a Mongo');

    const limit   = Number(process.env.MELI_SYNC_LIMIT    || 200);
    const delayMs = Number(process.env.MELI_SYNC_DELAY_MS || 150);

    const res = await syncPendingShipments({ limit, delayMs });
    console.log('[cron] meli-sync results:', JSON.stringify(res));

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[cron] Error fatal:', err?.response?.data || err.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();
