const express = require('express');
const router = express.Router();
const Token = require('../models/Token');

const CLIENT_ID = process.env.MERCADOLIBRE_CLIENT_ID;
const REDIRECT_URI = 'https://zupply-backend.onrender.com/auth/meli/callback';

router.get('/login', (req, res) => {
  const meliAuthURL = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  res.redirect(meliAuthURL);
});

const axios = require('axios');

router.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.MERCADOLIBRE_CLIENT_ID,
        client_secret: process.env.MERCADOLIBRE_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, refresh_token, user_id, expires_in } = response.data;

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

    console.log('✅ TOKEN:', access_token);
    res.send('¡Autenticación exitosa! Tokens recibidos y guardados en Mongo.');
  } catch (error) {
    console.error('❌ Error en OAuth callback:', error.response?.data || error.message);
    res.status(500).send('Error al procesar el token.');
  }
});

module.exports = router;
