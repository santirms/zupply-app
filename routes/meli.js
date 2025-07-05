const express = require('express');
const router = express.Router();
const axios = require('axios');
const Token = require('../models/Token');
const Cliente = require('../models/Cliente');

const CLIENT_ID = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI = 'https://zupply-backend.onrender.com/auth/meli/callback';

router.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    // 1. Intercambio del code por token
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token, user_id, expires_in } = response.data;

    // 2. Guardar o actualizar token
    await Token.findOneAndUpdate(
      { user_id },
      {
        access_token,
        refresh_token,
        expires_in,
        fecha_creacion: new Date()
      },
      { upsert: true, new: true }
    );

    // 3. Guardar o actualizar cliente asociado
    await Cliente.findOneAndUpdate(
      { sender_id: user_id }, // sender_id == user_id en los QR
      {
        sender_id: user_id,
        user_id,
        nombre: 'Cliente de Mercado Libre',
        lista_precios: 'base'
      },
      { upsert: true, new: true }
    );

    res.send('✅ ¡Autenticación exitosa! Token y cliente guardados correctamente.');
  } catch (error) {
    console.error('❌ Error en OAuth callback:', error.response?.data || error.message);
    res.status(500).send('Error al procesar el token.');
  }
});

module.exports = router;
