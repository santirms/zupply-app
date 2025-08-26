#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { syncPendingShipments } = require('../services/meliSync');

(async () => {
  console.log('[cron] runSyncPending started', new Date().toISOString());

  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.error('[cron] FALTA MONGODB_URI o DATABASE_URL');
    process.exit(1);
  }

  const opt = {};
  if (process.env.MONGODB_DB) opt.dbName = process.env.MONGODB_DB;

  try {
    await mongoose.connect(uri, opt);

    // podés tunear con envs, o quedan defaults
    const limit = Number(process.env.MELI_SYNC_LIMIT || 200);
    const delay = Number(process.env.MELI_SYNC_DELAY_MS || 150);

    const res = await syncPendingShipments({ limit, delayMs: delay });
    console.log('[cron] meli-sync results:', JSON.stringify(res));

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[cron] fatal:', err?.response?.data || err.stack || err.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();
