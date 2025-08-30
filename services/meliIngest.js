// services/meliIngest.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Zona  = require('../models/Zona');
const { getValidToken } = require('../utils/meliUtils');
const { mapMeliToInterno } = require('../utils/meliStatus');
const detectarZona = require('../utils/detectarZona');

/** Precio por zona usando la lista de precios del cliente */
async function precioPorZona(cliente, zonaNombre) {
  try {
    if (!cliente?.lista_precios || !zonaNombre) return 0;
    const zonaDoc = await Zona.findOne({ nombre: zonaNombre }, { _id: 1 });
    if (!zonaDoc) return 0;
    const zp = (cliente.lista_precios.zonas || [])
      .find(z => String(z.zona) === String(zonaDoc._id));
    return zp?.precio ?? 0;
  } catch {
    return 0;
  }
}

/** GET /shipments/:id */
async function fetchShipment(shipmentId, user_id) {
  const access_token = await getValidToken(user_id);
  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${shipmentId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return data;
}

/** GET /orders/:id -> pack_id (para “id de venta” 2000...) */
async function fetchPackIdFromOrder(orderId, user_id) {
  if (!orderId) return null;
  const access_token = await getValidToken(user_id);
  const { data: order } = await axios.get(
    `https://api.mercadolibre.com/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return order?.pack_id || null;
}

/** Determina si el envío es Flex (self_service) */
function esFlexDeVerdad(sh) {
  const lt = (sh?.shipping_option?.logistic_type || sh?.logistic_type || '').toLowerCase();
  const tags = [
    ...(Array.isArray(sh?.shipping_option?.tags) ? sh.shipping_option.tags : []),
    ...(Array.isArray(sh?.tags) ? sh.tags : []),
  ].map(t => String(t).toLowerCase());

  if (lt === 'self_service') return true;
  if (tags.some(t => /(^|_)self_service(_|$)|flex/.test(t))) return true;
  return false;
}

/**
 * Ingesta/actualización idempotente de un shipment de MeLi.
 * - Mapea estado ML -> interno
 * - Calcula partido/zona/precio
 * - Setea id_venta (pack_id > order_id)
 * - Escribe historial si cambió el estado
 */
async function ingestShipment({ shipmentId, cliente, source = 'meli:cron', actor_name = null }) {
  // 1) Traer shipment
  const sh = await fetchShipment(shipmentId, cliente.user_id);

  // 2) Filtrar NO-Flex
  if (!esFlexDeVerdad(sh)) {
    return { skipped: true, reason: 'non_flex', shipmentId };
  }

  // 3) Dirección
  const cp      = sh?.receiver_address?.zip_code || '';
  const dest    = sh?.receiver_address?.receiver_name || '';
  const street  = sh?.receiver_address?.street_name || '';
  const number  = sh?.receiver_address?.street_number || '';
  const address = [street, number].filter(Boolean).join(' ').trim();
  const ref     = sh?.receiver_address?.comment || '';

  // 4) Partido / Zona
  const { partido = '', zona: zonaNom = '' } = await detectarZona(cp) || {};

  // 5) Precio por zona/lista
  const precio = await precioPorZona(cliente, zonaNom);

  // 6) Estado ML e interno
  const estado_meli = {
    status:    sh.status || null,
    substatus: sh.substatus || null,
    updatedAt: new Date()
  };
  const estado_interno = mapMeliToInterno(sh.status, sh.substatus);

  // 7) IDs de venta (prioridad pack_id)
  //    En /shipments/:id a veces viene order_id; si no, intenta en sh.orders[0].id
  const order_id = sh?.order_id || (Array.isArray(sh?.orders) ? sh.orders[0]?.id : null) || null;
  let pack_id = null;
  try {
    pack_id = await fetchPackIdFromOrder(order_id, cliente.user_id);
  } catch {
    // no romper si falla orders
  }
  const id_venta = pack_id || order_id || null;

  // 8) Chequear cambios de estado para “historial”
  const prev = await Envio.findOne(
    { meli_id: String(sh.id) },
    { estado: 1, 'estado_meli.status': 1, 'estado_meli.substatus': 1 }
  ).lean();

  const changed =
    (prev?.estado ?? null) !== estado_interno ||
    (prev?.estado_meli?.status ?? null) !== estado_meli.status ||
    (prev?.estado_meli?.substatus ?? null) !== estado_meli.substatus;

  // 9) Upsert
  const update = {
    $setOnInsert: { fecha: new Date() },
    $set: {
      meli_id:       String(sh.id),
      sender_id:     String(cliente.codigo_cliente || cliente.sender_id?.[0] || cliente.user_id),
      cliente_id:    cliente._id,
      codigo_postal: cp,
      partido,
      zona:          zonaNom,
      destinatario:  dest,
      direccion:     address,
      referencia:    ref,
      precio,
      estado_meli,
      estado:        estado_interno,
      id_venta,
      order_id,
      pack_id
    }
  };

  if (changed) {
    update.$push = {
      historial: {
        at: new Date(),
        estado: estado_interno,
        estado_meli: { status: estado_meli.status, substatus: estado_meli.substatus },
        source,
        actor_name // para ML suele quedar null
      }
    };
  }

  const updated = await Envio.findOneAndUpdate(
    { meli_id: String(sh.id) },
    update,
    { upsert: true, new: true }
  );

  return updated.toObject ? updated.toObject() : updated;
}

module.exports = { ingestShipment };
