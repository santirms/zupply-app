// scripts/runMeliMaintenance.js
require('dotenv').config();
const mongoose = require('mongoose');

const Cliente = require('../models/Cliente');
require('../models/Envio'); // por si algún populate lo necesita

const { backfillCliente } = require('../services/meliBackfill');
const { syncPendingShipments } = require('../services/meliSync');

(async () => {
  try {
    // ---------- Conexión a Mongo ----------
    const uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL;
    if (!uri) throw new Error('FALTA MONGO_URI / MONGODB_URI / DATABASE_URL');

    const opt = {};
    if (process.env.MONGODB_DB) opt.dbName = process.env.MONGODB_DB;
    await mongoose.connect(uri, opt);
    console.log('[maintenance] Conectado a Mongo');

    // ---------- Parámetros (con defaults seguros) ----------
    const BACKFILL_DAYS       = Number(process.env.BACKFILL_DAYS || 1);   // últimos N días
    const BACKFILL_DELAY_MS   = Number(process.env.BACKFILL_DELAY_MS || 150);
    const SYNC_LIMIT          = Number(process.env.SYNC_LIMIT || 200);
    const SYNC_DELAY_MS       = Number(process.env.SYNC_DELAY_MS || 150);

    // ---------- (A) Backfill para clientes con auto_ingesta ----------
    const clientes = await Cliente.find({
      auto_ingesta: true,
      user_id: { $exists: true, $ne: null }
    }).populate('lista_precios');

    console.log(`[maintenance] Clientes con auto_ingesta: ${clientes.length} (days=${BACKFILL_DAYS})`);

    let bfTotals = { clientes: clientes.length, totalShipments: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    for (const cli of clientes) {
      try {
        const r = await backfillCliente({
          cliente: cli,
          days: BACKFILL_DAYS,
          delayMs: BACKFILL_DELAY_MS
        });
        bfTotals.totalShipments += r.total;
        bfTotals.created        += r.created;
        bfTotals.updated        += r.updated;
        bfTotals.skipped        += r.skipped;
        bfTotals.errors         += r.errors;
        console.log(`[maintenance] Backfill ${cli.nombre} ->`, r);
      } catch (e) {
        bfTotals.errors++;
        console.error('[maintenance] backfill error', cli._id?.toString(), e.response?.data || e.message);
      }
      await new Promise(r => setTimeout(r, 200)); // respiro entre clientes
    }

    console.log('[maintenance] Backfill resumen:', bfTotals);

    // ---------- (B) Sync de estados pendientes ----------
    const syncRes = await syncPendingShipments({
      limit: SYNC_LIMIT,
      delayMs: SYNC_DELAY_MS
    });
    console.log('[maintenance] Sync resumen:', syncRes);

    await mongoose.disconnect();
    console.log('[maintenance] OK');
    process.exit(0);
  } catch (err) {
    console.error('[maintenance] Error fatal:', err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();
