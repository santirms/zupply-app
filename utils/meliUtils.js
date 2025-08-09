// utils/meliUtils.js
const axios  = require('axios');
const Token  = require('../models/Token');
const Cliente = require('../models/Cliente');

// Refresca N segundos antes para evitar carreras de expiración
const EXPIRY_BUFFER_SEC = 60;

/**
 * Devuelve true si el token está expirado (considerando buffer).
 */
function estaExpirado(tokenDoc) {
  const base = tokenDoc.fecha_creacion ? new Date(tokenDoc.fecha_creacion) : new Date(0);
  const expMs = (tokenDoc.expires_in || 0) * 1000;
  const bufferMs = EXPIRY_BUFFER_SEC * 1000;
  return Date.now() >= (base.getTime() + expMs - bufferMs);
}

/**
 * Intercambia refresh_token por un access_token nuevo y persiste.
 */
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
  tokenDoc.refresh_token  = refresh_token || tokenDoc.refresh_token; // a veces ML no devuelve nuevo
  tokenDoc.expires_in     = expires_in;
  tokenDoc.fecha_creacion = new Date();
  await tokenDoc.save();

  return access_token;
}

/**
 * Devuelve un access_token válido para un user_id.
 * Si está expirado, lo refresca.
 */
async function getValidToken(user_id) {
  const tokenDoc = await Token.findOne({ user_id });
  if (!tokenDoc) throw new Error('Token no encontrado para ese user_id');

  if (estaExpirado(tokenDoc)) {
    return await refrescarToken(tokenDoc);
  }
  return tokenDoc.access_token;
}

/**
 * Helper: obtiene access_token a partir de un sender_id (buscando el cliente asociado).
 */
async function getTokenBySenderId(sender_id) {
  const cliente = await Cliente.findOne({ sender_id: sender_id });
  if (!cliente || !cliente.user_id) {
    throw new Error('No se encontró cliente o user_id para ese sender_id');
  }
  const access = await getValidToken(cliente.user_id);
  return { access_token: access, cliente };
}

/**
 * Hace GET a la API de ML con Authorization.
 * Si recibe 401, intenta refrescar y reintenta una vez.
 */
async function mlGet(url, { access_token, user_id }) {
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 && user_id) {
      // Reintentamos con refresh
      const tokenDoc = await Token.findOne({ user_id });
      if (!tokenDoc) throw err;

      const fresh = await refrescarToken(tokenDoc);
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${fresh}` }
      });
      return data;
    }
    throw err;
  }
}

/**
 * Devuelve info del envío (y opcionalmente sólo el CP) usando access_token válido.
 */
async function obtenerDatosDeEnvio(meli_id, user_id) {
  const access_token = await getValidToken(user_id);
  const data = await mlGet(
    `https://api.mercadolibre.com/shipments/${meli_id}`,
    { access_token, user_id }
  );
  return data; // retorna todo el objeto de shipment
}

async function obtenerCodigoPostalDeEnvio(meli_id, user_id) {
  const sh = await obtenerDatosDeEnvio(meli_id, user_id);
  return sh?.receiver_address?.zip_code || null;
}

module.exports = {
  getValidToken,
  getTokenBySenderId,
  mlGet,
  obtenerDatosDeEnvio,
  obtenerCodigoPostalDeEnvio
};
