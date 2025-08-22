// scripts/runSyncPending.js
require('dotenv').config();
const mongoose = require('mongoose');
const { syncPendingShipments } = require('../services/meliSync');

(async () => {
  try {
    // conecta a Mongo
    const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!uri) throw new Error('Falta MONGODB_URI');
    const opt = {};
    if (process.env.MONGODB_DB) opt.dbName = process.env.MONGODB_DB;
    await mongoose.connect(uri, opt);

    const res = await syncPendingShipments({ limit: 200, delayMs: 150 });
    console.log('[meli sync] resultado:', res);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[meli sync] error fatal:', err);
    process.exit(1);
  }
})();
