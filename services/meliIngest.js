// services/meliIngest.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Zona  = require('../models/Zona');
const detectarZona = require('../utils/detectarZona');

const { getValidToken }   = require('../utils/meliUtils');
const { mapMeliToInterno } = require('../utils/meliStatus');

/* ------------------------------
 * Helpers
 * ----------------------------*/

/** Precio según lista de precios del cliente y nombre de zona (no toca DB si falta info). */
async function precioPorZona(cliente, zonaNombre) {
  try {
    if (!cliente?.lista_precios || !zonaNombre) return 0;
    const zonaDoc = await Zona.findOne({ nombre: zonaNombre }, { _id: 1 });
    if (!zonaDoc) return 0;

    const hit = (cliente.lista_precios.zonas || [])
      .find(z => String(z.zona) === String(zonaDoc._id));
    return hit?.precio ?? 0;
  } catch {
    return 0;
  }
}

async function fetchShipment(shipmentId, user_id) {
  const access_token = await getValidToken(user_id);
  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${shipmentId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return data;
}

async function fetchPackIdFromOrder(orderId, user_id) {
  if (!orderId) return null;
  const access_token = await getValidToken(user_id);
  const { data: order } = await axios.get(
    `https://api.mercadolibre.com/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return order?.pack_id || null;
}

/** Flex “de verdad”: logistic_type self_service o tags equivalentes. */
function esFlexDeVerdad(sh) {
  const lt = (sh?.shipping_option?.logistic_type || sh?.logistic_type || '').toLowerCase();
  const tags = [
    ...(Array.isArray(sh?.shipping_option?.tags) ? sh.shipping_option.tags : []),
    ...(Array.isArray(sh?.tags) ? sh.tags : []),
  ].map(t => String(t).toLowerCase());

  if (lt === 'self_service') return true;
  if (tags.some(t => /(^|_)self_service(_|$)|flex/.test(t))) return true;

  return false; // ME clásico, fulfillment, etc.
}

/* ------------------------------
 * Ingesta principal
 * ----------------------------*/
async function ingestShipment({
  shipmentId,
  cliente,                 // ⚠️ con lista_precios populada si querés precio
  source = 'meli:cron',    // 'meli:webhook' | 'meli:cron' | 'meli:force-sync'
  actor_name = null        // normalmente null para ML
}) {
  // 1) Traer shipment
  const sh = await fetchShipment(shipmentId, cliente.user_id);

  // 2) Filtrar NO-Flex
  if (!esFlexDeVerdad(sh)) {
    return { skipped: true, reason: 'non_flex', shipmentId };
  }

  // 3) Direcciones
  const cp      = sh?.receiver_address?.zip_code || '';
  const dest    = sh?.receiver_address?.receiver_name || '';
  const street  = sh?.receiver_address?.street_name || '';
  const number  = sh?.receiver_address?.street_number || '';
  const address = [street, number].filter(Boolean).join(' ').trim();
  const ref     = sh?.receiver_address?.comment || '';

  // 4) Partido / zona (para facturación)
  const { partido = '', zona: zonaNom = '' } = await detectarZona(cp);

  // 5) Precio por zona
  const precio = await precioPorZona(cliente, zonaNom);

  // 6) Estados (MeLi + interno)
  const estado_meli = {
    status:    sh.status || null,
    substatus: sh.substatus || null,
    updatedAt: new Date()
  };
  let estado_interno = mapMeliToInterno(sh.status, sh.substatus); // ej: 'pendiente','en_camino','entregado',...

  // 7) IDs comerciales
  const order_id = sh?.order_id || null;
  let pack_id = null;
  try { pack_id = await fetchPackIdFromOrder(order_id, cliente.user_id); } catch (_) {}
  const id_venta = pack_id || order_id || null; // lo que mostrás/buscás en el panel

  // 8) Mirar el anterior para saber si cambió el estado
  const prev = await Envio.findOne(
    { meli_id: String(sh.id) },
    { estado: 1, 'estado_meli.status': 1, 'estado_meli.substatus': 1 }
  ).lean();

  const changed =
    !prev ||
    (prev.estado ?? null) !== estado_interno ||
    (prev?.estado_meli?.status ?? null) !== estado_meli.status ||
    (prev?.estado_meli?.substatus ?? null) !== estado_meli.substatus;

  // 9) Armar update idempotente
  const update = {
    $setOnInsert: { fecha: new Date() },
    $set: {
      meli_id:       String(sh.id),
      sender_id:     String(cliente.codigo_cliente || (cliente.sender_id?.[0]) || cliente.user_id),
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
      // Auditoría comercial:
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
        source,             // 'meli:webhook' | 'meli:cron' | 'meli:force-sync'
        actor_name,         // null para ML
        note: `ML: ${estado_meli.status || '-'}${estado_meli.substatus ? ' / ' + estado_meli.substatus : ''}`
      }
    };
  }

  // 10) Upsert + devolver doc actualizado
  const updated = await Envio.findOneAndUpdate(
    { meli_id: String(sh.id) },
    update,
    { upsert: true, new: true }
  ).lean();

  return updated;
}

module.exports = { ingestShipment };
