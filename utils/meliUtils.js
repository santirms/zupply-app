// utils/meliUtils.js
const axios  = require('axios');
const Token  = require('../models/Token');
const Cliente = require('../models/Cliente');

const EXPIRY_BUFFER_SEC = 60;

// ---------- EXISTENTE ----------
function estaExpirado(tokenDoc) {
  const base = tokenDoc.fecha_creacion ? new Date(tokenDoc.fecha_creacion) : new Date(0);
  const expMs = (tokenDoc.expires_in || 0) * 1000;
  const bufferMs = EXPIRY_BUFFER_SEC * 1000;
  return Date.now() >= (base.getTime() + expMs - bufferMs);
}
async function refrescarToken(tokenDoc) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.MERCADOLIBRE_CLIENT_ID,
    client_secret: process.env.MERCADOLIBRE_CLIENT_SECRET,
    refresh_token: tokenDoc.refresh_token
  });
  const { data } = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    body.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const { access_token, refresh_token, expires_in } = data;
  tokenDoc.access_token   = access_token;
  tokenDoc.refresh_token  = refresh_token || tokenDoc.refresh_token;
  tokenDoc.expires_in     = expires_in;
  tokenDoc.fecha_creacion = new Date();
  await tokenDoc.save();
  return access_token;
}
async function getValidToken(user_id) {
  const tokenDoc = await Token.findOne({ user_id });
  if (!tokenDoc) throw new Error('Token no encontrado para ese user_id');
  if (estaExpirado(tokenDoc)) return await refrescarToken(tokenDoc);
  return tokenDoc.access_token;
}
async function getTokenBySenderId(sender_id) {
  const cliente = await Cliente.findOne({ sender_id: sender_id });
  if (!cliente || !cliente.user_id) throw new Error('No se encontró cliente o user_id para ese sender_id');
  const access = await getValidToken(cliente.user_id);
  return { access_token: access, cliente };
}
async function mlGet(url, { access_token, user_id }) {
  try {
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${access_token}` } });
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 && user_id) {
      const tokenDoc = await Token.findOne({ user_id });
      if (!tokenDoc) throw err;
      const fresh = await refrescarToken(tokenDoc);
      const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${fresh}` } });
      return data;
    }
    throw err;
  }
}
async function obtenerDatosDeEnvio(meli_id, user_id) {
  const access_token = await getValidToken(user_id);
  const data = await mlGet(`https://api.mercadolibre.com/shipments/${meli_id}`, { access_token, user_id });
  return data;
}
async function obtenerCodigoPostalDeEnvio(meli_id, user_id) {
  const sh = await obtenerDatosDeEnvio(meli_id, user_id);
  return sh?.receiver_address?.zip_code || null;
}

// ---------- NUEVO: helpers para el flujo de “scan → crear/adjuntar” ----------
function parseQrPayload(text) {
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}
function extractKeys(p) {
  // intentá cubrir variantes comunes del QR Flex
  const tracking  = p?.tracking || p?.shipment_id || p?.id || p?.ml_shipment_id || null;
  const id_venta  = p?.id_venta || p?.order_id || p?.sale_id || p?.order || null;
  const sender_id = p?.sender_id || p?.seller_id || null;
  return { tracking, id_venta, sender_id };
}

// Token por cliente_id (seleccionado en el escáner)
async function getTokenByClienteId(cliente_id) {
  const cliente = await Cliente.findById(cliente_id).lean();
  if (!cliente?.user_id) throw new Error('Cliente sin user_id de MeLi');
  const access_token = await getValidToken(cliente.user_id);
  return { access_token, user_id: cliente.user_id, cliente };
}

// Cuando sólo tenemos order_id, buscamos la orden para derivar el shipment
async function obtenerOrden(order_id, user_id) {
  const access_token = await getValidToken(user_id);
  return await mlGet(`https://api.mercadolibre.com/orders/${order_id}`, { access_token, user_id });
}

/**
 * Trae el objeto de shipment desde MeLi, usando:
 *  - shipment_id (tracking del QR) si está
 *  - o bien order_id -> shipment_id
 */
async function fetchShipmentFromMeli({ tracking, id_venta, user_id }) {
  const access_token = await getValidToken(user_id);

  if (tracking) {
    // En la práctica, el "tracking" del QR suele ser shipment_id
    return await mlGet(`https://api.mercadolibre.com/shipments/${tracking}`, { access_token, user_id });
  }

  if (id_venta) {
    const order = await mlGet(`https://api.mercadolibre.com/orders/${id_venta}`, { access_token, user_id });
    const shipmentId =
      order?.shipping?.id ||
      order?.shipping?.shipment_id ||
      null;

    if (shipmentId) {
      return await mlGet(`https://api.mercadolibre.com/shipments/${shipmentId}`, { access_token, user_id });
    }

    // fallback si tu cuenta expone este endpoint
    const shipFromOrder = await mlGet(`https://api.mercadolibre.com/orders/${id_venta}/shipments`, { access_token, user_id });
    return shipFromOrder?.results?.[0] || shipFromOrder;
  }

  throw new Error('fetchShipmentFromMeli: faltan claves tracking o id_venta');
}

// ---------- EXPORTS ----------
module.exports = {
  // existentes
  getValidToken,
  getTokenBySenderId,
  mlGet,
  obtenerDatosDeEnvio,
  obtenerCodigoPostalDeEnvio,
  // nuevos
  parseQrPayload,
  extractKeys,
  getTokenByClienteId,
  obtenerOrden,
  fetchShipmentFromMeli
};
