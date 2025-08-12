// routes/escanear.js

const express = require('express');
const router = express.Router();
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const detectarZona = require('../utils/detectarZona');
const { getValidToken } = require('../utils/meliUtils');
const axios = require('axios');

// 🔹 Ruta para escaneo manual (cliente no vinculado a MeLi)
router.post('/manual', async (req, res) => {
  // ... tu lógica actual
});

// 🔹 Ruta para escaneo automático con integración MeLi
router.post('/meli', async (req, res) => {
  try {
    // tolerante a distintos nombres
    const sender_id  = String(req.body.sender_id || '');
    const meli_id    = String(req.body.meli_id || req.body.id || '');
    const hashnumber = String(req.body.hashnumber || req.body.hash_code || req.body.hash || '');

    if (!sender_id || !meli_id) {
      return res.status(400).json({ error: 'Faltan sender_id o meli_id' });
    }

    const cliente = await Cliente.findOne({ sender_id });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const access_token = await getValidToken(cliente.user_id);

    const response = await axios.get(`https://api.mercadolibre.com/shipments/${meli_id}`, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    const datosEnvio = mlRes.data;

    // 4) Detectamos zona/partido
    const cp      = datosEnvio.receiver_address.zip_code;
    const zonaObj = await detectarZona(cp);

    // 5) Creamos y guardamos el envío en Mongo
    const nuevo = new Envio({
      meli_id,
      sender_id,
      cliente_id: cliente._id,
      codigo_postal: cp,
      partido: zonaObj.partido,
      zona:    zonaObj.zona,
      destinatario: datosEnvio.receiver_address.receiver_name,
      direccion:     datosEnvio.receiver_address.street_name + ' ' + datosEnvio.receiver_address.street_number,
      referencia:    datosEnvio.receiver_address.comment,
      datos_completos: datosEnvio,
      fecha: new Date()
    });
    await nuevo.save();

    return res.json({ mensaje: 'Envío guardado', envio: nuevo });
  } catch (err) {
    console.error('Error en escaneo MeLi:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al obtener o guardar el envío desde MeLi' });
  }
});

module.exports = router;
