const axios = require('axios');
const Token = require('../models/Token');

/**
 * Devuelve el código postal del envío, usando un access_token válido.
 */
async function obtenerCodigoPostalDeEnvio(meli_id, access_token) {
  try {
    const url = `https://api.mercadolibre.com/shipments/${meli_id}?access_token=${access_token}`;
    const response = await axios.get(url);
    const data = response.data;
    return data?.receiver_address?.zip_code || null;
  } catch (error) {
    console.error("Error al obtener datos del envío de MeLi:", error.message);
    return null;
  }
}

/**
 * Devuelve un access_token válido desde la base de datos, o lo refresca si venció.
 */
async function getValidToken(user_id) {
  const token = await Token.findOne({ user_id });

  if (!token) throw new Error('Token no encontrado');

  const expirado = Date.now() > (new Date(token.fecha_creacion).getTime() + token.expires_in * 1000);

  if (!expirado) {
    return token.access_token;
  }

  // Refrescar token
  const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
    params: {
      grant_type: 'refresh_token',
      client_id: process.env.MERCADOLIBRE_CLIENT_ID,
      client_secret: process.env.MERCADOLIBRE_CLIENT_SECRET,
      refresh_token: token.refresh_token
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  const { access_token, refresh_token, expires_in } = response.data;

  // Actualizar token en base de datos
  token.access_token = access_token;
  token.refresh_token = refresh_token;
  token.expires_in = expires_in;
  token.fecha_creacion = new Date();
  await token.save();

  return access_token;
}

module.exports = {
  obtenerCodigoPostalDeEnvio,
  getValidToken
};
