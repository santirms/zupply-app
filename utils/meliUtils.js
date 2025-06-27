const axios = require('axios');

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

module.exports = { obtenerCodigoPostalDeEnvio };