// scripts/debug-meli-case.js
require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const axios = require('axios');
const { getValidToken } = require('../utils/meliUtils');

async function get(access, url) {
  const r = await axios.get(url, {
    headers: { Authorization: `Bearer ${access}` },
    timeout: 10000,
    validateStatus: s => s >= 200 && s < 500,
  });
  return r;
}

(async () => {
  const arg = process.argv[2];
  if (!arg) { console.error('Uso: node scripts/debug-meli-case.js <envioId|meli_id>'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);

  let envio = await Envio.findOne({ _id: arg }).lean();
  if (!envio) envio = await Envio.findOne({ meli_id: arg }).lean();
  if (!envio) { console.error('No encontré Envío por _id ni por meli_id'); process.exit(1); }

  const cliente = await Cliente.findById(envio.cliente_id).lean();
  const access = await getValidToken(cliente.user_id);

  console.log('ENVIO', { _id: envio._id.toString(), meli_id: envio.meli_id, order: envio.venta_id_meli || envio.order_id_meli || envio.order_id || null });

  // shipment
  const s = await get(access, `https://api.mercadolibre.com/shipments/${envio.meli_id}`);
  console.log('SHIPMENT', s.status, s.data?.id, s.data?.status, s.data?.substatus, s.data?.logistic_type);

  // history
  const h = await get(access, `https://api.mercadolibre.com/shipments/${envio.meli_id}/history`);
  const body = h.data;
  const arr = Array.isArray(body) ? body : (body.results ?? body.history ?? body.entries ?? body.events ?? body.timeline ?? []);
  console.log('HISTORY', h.status, Array.isArray(arr) ? arr.length : 'n/a', Object.keys(body||{}));

  // si vacio, y hay order, probá resolver shipment por order
  const orderId = envio.venta_id_meli || envio.order_id_meli || envio.order_id;
  if ((!Array.isArray(arr) || !arr.length) && orderId) {
    const r = await get(access, `https://api.mercadolibre.com/orders/${orderId}/shipments`);
    console.log('ORDER→SHIPMENTS', r.status, Array.isArray(r.data?.results) ? r.data.results.map(x=>x.id) : r.data);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
