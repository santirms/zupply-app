#!/usr/bin/env node
require('../utils/logger');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('Falta MONGO_URI'); process.exit(1); }

const Envio = require('../models/Envio');
const { ensureMeliHistory } = require('../services/meliHistory');

(async () => {
  const meliId = process.argv[2];
  if (!meliId) { console.error('Uso: node scripts/hydrate-one.js <MELI_ID>'); process.exit(1); }

  await mongoose.connect(MONGO_URI, { maxPoolSize: 5 });

  const envio = await Envio.findOne({ meli_id: String(meliId) });
  if (!envio) {
    console.error('No encontré Envio con meli_id =', meliId);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('[hydrate-one] antes:', {
    estado: envio.estado,
    estado_meli: envio.estado_meli,
    historial_len: Array.isArray(envio.historial) ? envio.historial.length : 0
  });

  // Fuerza rebuild para que use el fallback desde shipment si /history viene vacío
  process.env.MELI_HISTORY_DEBUG = '1';
  await ensureMeliHistory(envio, { force: true, rebuild: true });

  const refreshed = await Envio.findById(envio._id).lean();

  console.log('[hydrate-one] después:', {
    estado: refreshed.estado,
    estado_meli: refreshed.estado_meli,
    historial_len: Array.isArray(refreshed.historial) ? refreshed.historial.length : 0
  });

  // Mostrar los eventos MeLi ordenados (para inspección rápida)
  const hist = Array.isArray(refreshed.historial) ? refreshed.historial : [];
  const meliEvts = hist
    .filter(h => h.actor_name === 'MeLi' || String(h.source||'').startsWith('meli-history'))
    .sort((a,b) => new Date(a.at) - new Date(b.at));

  console.log('[hydrate-one] eventos MeLi:');
  for (const e of meliEvts) {
    console.log('  -', e.at, (e.estado_meli?.status || e.estado || e.tipo), e.estado_meli?.substatus || '', e.source);
  }

  await mongoose.disconnect();
  process.exit(0);
})();
