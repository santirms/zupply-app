// scripts/backfill-history-today.js
require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { ingestShipment } = require('../services/meliIngest');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) throw new Error('Falta MONGODB_URI');

  await mongoose.connect(uri);
  const hoy = new Date();
  const start = new Date(hoy); start.setHours(0,0,0,0);
  const end   = new Date(hoy); end.setHours(23,59,59,999);

  // Trae TODOS los envíos de hoy que tengan meli_id
  const envios = await Envio.find({
    meli_id: { $exists: true, $nin: [null, ''] },
    fecha: { $gte: start, $lte: end }
  }).select('_id meli_id cliente_id').lean();

  console.log('Backfill hoy:', envios.length, 'envíos');

  // Cache de clientes con user_id (indispensable para consultar ML)
  const clienteIds = [...new Set(envios.map(e => String(e.cliente_id)))];
  const clientes = await Cliente.find({ _id: { $in: clienteIds } })
    .select('_id user_id lista_precios sender_id codigo_cliente')
    .populate('lista_precios')
    .lean();
  const byId = Object.fromEntries(clientes.map(c => [String(c._id), c]));

  let ok = 0, skip = 0, fail = 0;
  for (const e of envios) {
    const cliente = byId[String(e.cliente_id)];
    if (!cliente?.user_id) { skip++; continue; } // no vinculado → no se puede pedir a MeLi

    try {
      await ingestShipment({ shipmentId: e.meli_id, cliente, source: 'backfill' });
      ok++;
    } catch (err) {
      fail++;
      console.error('falló', e._id, e.meli_id, err.response?.data || err.message);
    }
    await new Promise(r => setTimeout(r, 150)); // rate-limit suave
  }

  console.log({ ok, skip_no_user: skip, fail, total: envios.length });
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
