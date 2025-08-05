// routes/meli.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const Token   = require('../models/Token');
const Cliente = require('../models/Cliente');

const CLIENT_ID     = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.MERCADOLIBRE_REDIRECT_URI;

router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Faltan parámetros en callback');
    }

    // 1) Intercambio de code por tokens
    const tokenRes = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
      params: {
        grant_type:    'authorization_code',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri:  REDIRECT_URI
      },
      headers: { 'Content-Type':'application/x-www-form-urlencoded' }
    });
    const { access_token, refresh_token, user_id } = tokenRes.data;

    // 2) Guardar tokens en la colección Token
    await Token.findOneAndUpdate(
      { user_id },
      { access_token, refresh_token, updatedAt: new Date() },
      { upsert: true }
    );

    // 3) Leer state para saber a qué cliente y sender_id asociar
    //    state fue "${clienteId}|${senderId}"
    const [clienteId, senderId] = state.split('|');

    // 4) Actualizar el Cliente: marcamos que tiene este user_id y acceso
    await Cliente.findByIdAndUpdate(clienteId, {
      user_id,
      // añadimos senderId si no existía ya
      $addToSet: { sender_id: senderId }
    });

    return res.send('✅ Autenticación exitosa y cliente vinculado.');
  } catch (err) {
    console.error('Error en OAuth callback:', err.response?.data || err.message);
    return res.status(500).send('❌ Error durante el callback OAuth');
  }
});

module.exports = router;

