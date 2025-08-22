// services/meliIngest.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Zona  = require('../models/Zona');
const { getValidToken } = require('../utils/meliUtils');
const { mapMeliToInterno } = require('../utils/meliStatus');

// helper para precio por zona (omito si ya lo tenés)
async function precioPorZona(cliente, zonaNombre) { /* ... */ }

async function fetchShipment(shipmentId, user_id) {
  const access_token = await getValidToken(user_id);
  const { data: sh } = await axios.get(
    `https://api.mercadolibre.com/shipments/${shipmentId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return sh;
}

async function fetchPackIdFromOrder(orderId, user_id) {
  if (!orderId) return null;
  const access_token = await getValidToken(user_id);
  const { data: order } = await axios.get(
    `https://api.mercadolibre.com/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  // orders API trae pack_id cuando corresponde
  return order?.pack_id || null;
}

async function ingestShipment({ shipmentId, cliente }) {
  const sh = await fetchShipment(shipmentId, cliente.user_id);

  // address
  const cp       = sh?.receiver_address?.zip_code || '';
  const dest     = sh?.receiver_address?.receiver_name || '';
  const street   = sh?.receiver_address?.street_name || '';
  const number   = sh?.receiver_address?.street_number || '';
  const address  = [street, number].filter(Boolean).join(' ').trim();
  const ref      = sh?.receiver_address?.comment || '';

  // partido/zona
  const detectarZona = require('../utils/detectarZona');
  const { partido = '', zona: zonaNom = '' } = await detectarZona(cp);

  // precio
  const precio = await precioPorZona(cliente, zonaNom);

  // estado (meli + interno)
  const estado_meli = {
    status:    sh.status || null,
    substatus: sh.substatus || null,
    updatedAt: new Date()
  };
  const estado = mapMeliToInterno(sh.status, sh.substatus);

  // *** IDs ***
  const order_id = sh?.order_id || null;            // viene en /shipments/:id
  let pack_id = null;
  try { pack_id = await fetchPackIdFromOrder(order_id, cliente.user_id); } catch {}

  // lo que mostrás/buscás en el panel:
  const id_venta = pack_id || order_id || null;

  // upsert
  const res = await Envio.findOneAndUpdate(
    { meli_id: String(sh.id) },
    {
      $setOnInsert: { fecha: new Date() },
      $set: {
        meli_id: String(sh.id),
        sender_id: (cliente.codigo_cliente || cliente.sender_id?.[0] || cliente.user_id) + '',
        cliente_id: cliente._id,
        codigo_postal: cp,
        partido,
        zona: zonaNom,
        destinatario: dest,
        direccion: address,
        referencia: ref,
        precio,
        estado_meli,
        estado,
        // 👇 nuevos / corregidos
        id_venta,       // PRIORIDAD pack_id
        order_id,       // por si querés auditar
        pack_id         // guardalo también; Mongo es flexible
      }
    },
    { upsert: true, new: true }
  );

  return res;
}

module.exports = { ingestShipment };
