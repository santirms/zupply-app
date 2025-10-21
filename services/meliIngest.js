// services/meliIngest.js
'use strict';

const axios  = require('axios');
const Envio  = require('../models/Envio');
const Zona   = require('../models/Zona');
const { getValidToken }   = require('../utils/meliUtils');
const { mapMeliToInterno }= require('../utils/meliStatus');
const detectarZona        = require('../utils/detectarZona');
const logger              = require('../utils/logger');

// ---------- precio por zona ----------
async function precioPorZona(cliente, zonaNombre) {
  try {
    if (!cliente?.lista_precios || !zonaNombre) return 0;
    const zonaDoc = await Zona.findOne({ nombre: zonaNombre }, { _id: 1 });
    if (!zonaDoc) return 0;
    const zp = (cliente.lista_precios.zonas || [])
      .find(z => String(z.zona) === String(zonaDoc._id));
    return zp?.precio ?? 0;
  } catch { return 0; }
}

// ---------- fetch ML ----------
async function fetchShipment(shipmentId, user_id) {
  const access_token = await getValidToken(user_id);
  const url = `/shipments/${shipmentId}`;
  const startTime = Date.now();

  try {
    const { data, status } = await axios.get(
      `https://api.mercadolibre.com${url}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    logger.ml('Shipment fetched', shipmentId, {
      status,
      duration_ms: Date.now() - startTime
    });

    return data || {};
  } catch (error) {
    logger.api(
      'MercadoLibre',
      'GET',
      url,
      error.response?.status || 0,
      Date.now() - startTime
    );
    throw error;
  }
}

async function fetchShipmentHistory(shipmentId, user_id) {
  const access_token = await getValidToken(user_id);
  const url = `/shipments/${shipmentId}/history`;
  const startTime = Date.now();

  try {
    const { data, status } = await axios.get(
      `https://api.mercadolibre.com${url}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    logger.ml('Shipment history fetched', shipmentId, {
      status,
      duration_ms: Date.now() - startTime
    });

    // Puede venir como array o como {results:[...]}
    return Array.isArray(data) ? data : (data?.results || []);
  } catch (error) {
    logger.api(
      'MercadoLibre',
      'GET',
      url,
      error.response?.status || 0,
      Date.now() - startTime
    );
    throw error;
  }
}

async function fetchPackIdFromOrder(orderId, user_id) {
  if (!orderId) return null;
  const access_token = await getValidToken(user_id);
  const url = `/orders/${orderId}`;
  const startTime = Date.now();

  try {
    const { data: order, status } = await axios.get(
      `https://api.mercadolibre.com${url}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    logger.ml('Order fetched', orderId, {
      status,
      duration_ms: Date.now() - startTime
    });

    return order?.pack_id || null;
  } catch (error) {
    logger.api(
      'MercadoLibre',
      'GET',
      url,
      error.response?.status || 0,
      Date.now() - startTime
    );
    throw error;
  }
}

// ---------- util ML ----------
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

function mapHistory(items = []) {
  // items: [{date, status, substatus, ...}]
  return items.map(e => {
    const status = (e.status || '').toLowerCase();
    const sub    = (e.substatus || '').toLowerCase() || null;
    return {
      at: new Date(e.date),                  // <-- HORA REAL de MeLi
      estado: mapMeliToInterno(status, sub),
      estado_meli: { status, substatus: sub },
      source: 'meli-history',
      actor_name: 'MeLi',
      note: ''
    };
  });
}

function mergeHistorial(existing = [], incoming = []) {
  const key = (h) =>
    `${+new Date(h.at || h.updatedAt || 0)}|${(h.estado_meli?.status||'')}|${(h.estado_meli?.substatus||'')}`;
  const seen = new Set(existing.map(key));
  const out  = existing.slice();
  for (const h of incoming) {
    const k = key(h);
    if (!seen.has(k)) { out.push(h); seen.add(k); }
  }
  out.sort((a,b)=> new Date(a.at || 0) - new Date(b.at || 0));
  return out;
}

/**
 * Ingesta/actualización idempotente de un shipment de MeLi.
 * - Trae /shipments y /shipments/history
 * - Actualiza estado visible con el ULTIMO evento real
 * - Guarda historial con hora real de ML y mergea sin duplicar
 * - Completa id_venta (pack_id > order_id) si falta
 */
async function ingestShipment({ shipmentId, cliente, source = 'meli:cron', actor_name = null }) {
  // 1) MeLi: shipment + history
  const sh = await fetchShipment(shipmentId, cliente.user_id);
  if (!esFlexDeVerdad(sh)) return { skipped: true, reason: 'non_flex', shipmentId };

  const histRaw = await fetchShipmentHistory(sh.id, cliente.user_id);
  const histMap = mapHistory(histRaw);

  // 2) Datos de dirección/cliente
  const cp      = sh?.receiver_address?.zip_code || '';
  const dest    = sh?.receiver_address?.receiver_name || '';
  const street  = sh?.receiver_address?.street_name || '';
  const number  = sh?.receiver_address?.street_number || '';
  const address = [street, number].filter(Boolean).join(' ').trim();
  const ref     = sh?.receiver_address?.comment || '';

  // ========== EXTRAER COORDENADAS DE MERCADOLIBRE ==========
  let latitud = null;
  let longitud = null;
  let geocode_source = null;

  if (sh?.receiver_address) {
    const addr = sh.receiver_address;
    const lat = addr.latitude || addr.lat || addr.geolocation?.latitude || null;
    const lon = addr.longitude || addr.lon || addr.lng || addr.geolocation?.longitude || null;

    if (lat && lon) {
      const latNum = Number(lat);
      const lonNum = Number(lon);

      if (
        !isNaN(latNum) && !isNaN(lonNum) &&
        latNum !== 0 && lonNum !== 0 &&
        latNum >= -55.1 && latNum <= -21.7 &&
        lonNum >= -73.6 && lonNum <= -53.5
      ) {
        latitud = latNum;
        longitud = lonNum;
        geocode_source = 'mercadolibre';
        logger.debug('Coords de MeLi', { shipment_id: sh.id, latitud, longitud });
      } else {
        logger.warn('Coords inválidas/fuera de Argentina', {
          shipment_id: sh.id,
          lat: latNum,
          lon: lonNum
        });
      }
    }
  }
  // ========== FIN EXTRACCIÓN ==========

  // 3) Partido / Zona / Precio
  const { partido = '', zona: zonaNom = '' } = await detectarZona(cp) || {};
  const precio = await precioPorZona(cliente, zonaNom);

  // 4) order/pack para id_venta
  const order_id = sh?.order_id || (Array.isArray(sh?.orders) ? sh.orders[0]?.id : null) || null;
  let pack_id = null; try { pack_id = await fetchPackIdFromOrder(order_id, cliente.user_id); } catch {}
  const id_venta = pack_id || order_id || null;

  // 5) Último evento real (o fallback a shipment.last_updated)
  const last = histMap.slice().sort((a,b)=> new Date(b.at) - new Date(a.at))[0] || {
    at: new Date(sh.last_updated || sh.date_created || Date.now()),
    estado: mapMeliToInterno(sh.status, sh.substatus),
    estado_meli: {
      status: (sh.status || '').toLowerCase(),
      substatus: (sh.substatus || '').toLowerCase() || null
    }
  };

  // 6) Merge de historial
  const existing = await Envio.findOne({ meli_id: String(sh.id) }).lean();
  const historialMerged = existing?.historial?.length
    ? mergeHistorial(existing.historial, histMap)
    : histMap;

  // 7) Upsert con hora real en estado_meli.updatedAt
 const update = {
  $setOnInsert: { fecha: new Date(sh.date_created || Date.now()) },
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
    id_venta,
    order_id,
    pack_id,
    // Estado "actual" (lo afinamos luego con ensureMeliHistory)
    estado: mapMeliToInterno(sh.status, sh.substatus),
    estado_meli: {
      status:    sh.status || null,
      substatus: sh.substatus || null,
      updatedAt: new Date()   // luego se corrige con la hora real de MeLi
    },
    ml_status: sh.status || null,
    ml_substatus: sh.substatus || null
  }
};

  if (latitud !== null && longitud !== null) {
    const shouldUpdateCoords =
      !existing?.latitud ||
      !existing?.longitud ||
      existing?.geocode_source !== 'mercadolibre';

    if (shouldUpdateCoords) {
      update.$set.latitud = latitud;
      update.$set.longitud = longitud;
      update.$set.geocode_source = geocode_source;
      logger.debug('Guardando coordenadas de MeLi (ingest)', {
        shipment_id: sh.id,
        latitud,
        longitud
      });
    }
  }


  const updated = await Envio.findOneAndUpdate(
    { meli_id: String(sh.id) },
    update,
    { upsert: true, new: true }
  );

  return updated.toObject ? updated.toObject() : updated;
}

module.exports = { ingestShipment };
