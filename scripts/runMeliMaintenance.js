require('../utils/logger');
require('dotenv').config();
const mongoose = require('mongoose');
const Cliente = require('../models/Cliente');
const Tenant = require('../models/Tenant');
require('../models/Envio');
require('../models/listaDePrecios');
require('../models/partidos');
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

    // ---------- Parámetros ----------
    const BACKFILL_DAYS     = Number(process.env.BACKFILL_DAYS || 1);
    const BACKFILL_DELAY_MS = Number(process.env.BACKFILL_DELAY_MS || 150);
    const SYNC_LIMIT        = Number(process.env.SYNC_LIMIT || 200);
    const SYNC_DELAY_MS     = Number(process.env.SYNC_DELAY_MS || 150);

    // ---------- MULTI-TENANT: Iterar por cada tenant activo ----------
    const tenants = await Tenant.find({ isActive: true });
    console.log(`[maintenance] Tenants activos: ${tenants.length}`);

    let globalTotals = {
      tenants: tenants.length,
      clientesTotal: 0,
      totalShipments: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    for (const tenant of tenants) {
      console.log(`\n[maintenance] === Procesando tenant: ${tenant.companyName} (${tenant.subdomain}) ===`);

      // Verificar que tenga ML conectado
      if (!tenant.mlIntegration?.accessToken) {
        console.log(`[maintenance] ⚠️  Tenant ${tenant.subdomain} no tiene ML conectado, saltando...`);
        continue;
      }

      // ---------- (A) Backfill para clientes de ESTE tenant ----------
      const clientes = await Cliente.find({
        tenantId: tenant._id,
        auto_ingesta: true,
        user_id: { $exists: true, $ne: null }
      }).populate('lista_precios');

      console.log(`[maintenance] Clientes con auto_ingesta en ${tenant.subdomain}: ${clientes.length}`);
      globalTotals.clientesTotal += clientes.length;

      for (const cli of clientes) {
        try {
          const r = await backfillCliente({
            cliente: cli,
            days: BACKFILL_DAYS,
            delayMs: BACKFILL_DELAY_MS,
            tenantId: tenant._id,  // ← PASAR tenantId
            mlToken: tenant.mlIntegration.accessToken  // ← Token del tenant
          });
          
          globalTotals.totalShipments += r.total;
          globalTotals.created        += r.created;
          globalTotals.updated        += r.updated;
          globalTotals.skipped        += r.skipped;
          globalTotals.errors         += r.errors;
          
          console.log(`[maintenance] Backfill ${cli.nombre} ->`, r);
        } catch (e) {
          globalTotals.errors++;
          console.error('[maintenance] backfill error', cli._id?.toString(), e.response?.data || e.message);
        }
        
        await new Promise(r => setTimeout(r, 200));
      }

      // ---------- (B) Sync de estados pendientes de ESTE tenant ----------
      const syncRes = await syncPendingShipments({
        limit: SYNC_LIMIT,
        delayMs: SYNC_DELAY_MS,
        tenantId: tenant._id,  // ← PASAR tenantId
        mlToken: tenant.mlIntegration.accessToken  // ← Token del tenant
      });
      
      console.log(`[maintenance] Sync resumen ${tenant.subdomain}:`, syncRes);

      await new Promise(r => setTimeout(r, 500)); // Respiro entre tenants
    }

    console.log('\n[maintenance] === RESUMEN GLOBAL ===');
    console.log(globalTotals);

    await mongoose.disconnect();
    console.log('[maintenance] OK');
    process.exit(0);
  } catch (err) {
    console.error('[maintenance] Error fatal:', err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
})();
