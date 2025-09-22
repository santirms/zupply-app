// scripts/debug-meli-case.js
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const isObjectId = (v) => mongoose.isValidObjectId(v);

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
  if (!arg) { console.error('Uso: node scripts/debug-meli-case.js <envioId|meli_id|tracking|orderId>'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);

  // 1) Buscar sin forzar cast a ObjectId
  let envio = null;
  if (isObjectId(arg)) {
    envio = await Envio.findOne({ _id: arg }).lean();
  }
  if (!envio) {
    envio = await Envio.findOne({
      $or: [
        { meli_id: arg },
        { tracking_meli: arg },
        { venta_id_meli: arg },
        { order_id_meli: arg },
        { order_id: arg },
      ].filter(Boolean)
    }).lean();
  }

  if (!envio) {
    console.error('No encontré Envío por _id/meli_id/tracking/orderId:', arg);
    process.exit(1);
  }

  // 2) Token de cliente
  const cliente = await Cliente.findById(envio.cliente_id).lean();
  if (!cliente?.user_id) {
    console.error('Cliente sin user_id para OAuth:', envio.cliente_id?.toString?.());
    process.exit(1);
  }
  const access = await getValidToken(cliente.user_id);
  if (!access) { console.error('No pude obtener access token'); process.exit(1); }

  const orderId = envio.venta_id_meli || envio.order_id_meli || envio.order_id || null;

  console.log('ENVIO', {
    _id: envio._id.toString(),
    meli_id: envio.meli_id,
    tracking_meli: envio.tracking_meli,
    orderId,
    estado: envio.estado,
    updatedAt: envio.updatedAt,
  });

  // 3) Probar shipment con lo que haya en meli_id
  let shipmentId = envio.meli_id;
  let s = null;
  if (shipmentId) {
    const sr = await get(access, `https://api.mercadolibre.com/shipments/${shipmentId}`);
    s = sr.data;
    console.log('SHIPMENT(via meli_id)', sr.status, s?.id, s?.status, s?.substatus, s?.logistic_type);
  } else {
    console.log('SHIPMENT(via meli_id) SKIP: no hay meli_id');
  }

  // 4) History con ese shipment (si hay)
  if (shipmentId) {
    const hr = await get(access, `https://api.mercadolibre.com/shipments/${shipmentId}/history`);
    const body = hr.data ?? {};
    const arr = Array.isArray(body) ? body : (body.results ?? body.history ?? body.entries ?? body.events ?? body.timeline ?? []);
    console.log('HISTORY(via meli_id)', hr.status, Array.isArray(arr) ? arr.length : 'n/a', Object.keys(body||{}));
  }

  // 5) Si no hay shipment o history vacío, y tenemos orderId: resolver shipment desde la orden
  if (orderId) {
    const or = await get(access, `https://api.mercadolibre.com/orders/${orderId}/shipments`);
    const list = Array.isArray(or.data) ? or.data : (or.data?.results || []);
    console.log('ORDER→SHIPMENTS', or.status, Array.isArray(list) ? list.map(x => x.id) : list);

    const resolved = Array.isArray(list) && list[0]?.id ? `${list[0].id}` : null;
    if (resolved && resolved !== shipmentId) {
      shipmentId = resolved;
      const sr2 = await get(access, `https://api.mercadolibre.com/shipments/${shipmentId}`);
      const s2 = sr2.data;
      console.log('SHIPMENT(via order)', sr2.status, s2?.id, s2?.status, s2?.substatus, s2?.logistic_type);

      const hr2 = await get(access, `https://api.mercadolibre.com/shipments/${shipmentId}/history`);
      const body2 = hr2.data ?? {};
      const arr2 = Array.isArray(body2) ? body2 : (body2.results ?? body2.history ?? body2.entries ?? body2.events ?? body2.timeline ?? []);
      console.log('HISTORY(via order)', hr2.status, Array.isArray(arr2) ? arr2.length : 'n/a', Object.keys(body2||{}));
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
