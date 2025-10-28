require('../utils/logger');
// scripts/fix-meli-id.js
// Corrige meli_id guardados como tracking → shipment.id (requiere OAuth del cliente)
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const LIMIT = Number(process.argv[2] || 500);

(async function main(){
  if (!process.env.MONGO_URI) {
    console.error('Falta MONGO_URI'); process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { maxPoolSize: 10 });

  // historial "pobre": length < 2 (incluye inexistente/no array)
  const poorExpr = {
    $expr: {
      $lt: [
        { $cond: [
          { $isArray: "$historial" },
          { $size: "$historial" },
          0
        ]},
        2
      ]
    }
  };

  const q = {
    meli_id: { $exists: true, $ne: null, $ne: '' },
    ...poorExpr
  };

  const envios = await Envio.find(q)
    .select('_id meli_id cliente_id')
    .limit(LIMIT)
    .lean();

  console.log(`[fix-meli-id] candidatos=${envios.length}`);

  let ok=0, same=0, skip=0, fail=0;
  for (const e of envios) {
    try {
      const cliente = await Cliente.findById(e.cliente_id).lean();
      if (!cliente?.user_id) { skip++; continue; }
      const access = await getValidToken(cliente.user_id);
      if (!access) { skip++; continue; }

      const r = await axios.get(
        `https://api.mercadolibre.com/shipments/${e.meli_id}`,
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 10000,
          validateStatus: s => s >= 200 && s < 500,
        }
      );
      if (r.status >= 400) { skip++; continue; }

      const sh = r.data || {};
      if (sh?.id && `${sh.id}` !== `${e.meli_id}`) {
        await Envio.updateOne({ _id: e._id }, { $set: { meli_id: `${sh.id}` } });
        console.log(` ✓ fix ${e._id}  ${e.meli_id} → ${sh.id}`);
        ok++;
      } else {
        same++;
      }
    } catch (err) {
      console.log(` ✗ ${e._id} err=${err?.message || err}`); fail++;
    }
  }

  console.log(`[fix-meli-id] listo ok=${ok} same=${same} skip=${skip} fail=${fail}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
