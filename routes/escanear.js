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
    const { meli_id, sender_id } = req.body;

    if (!meli_id || !sender_id) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
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

    const datosEnvio = response.data;

    const codigo_postal = datosEnvio?.receiver_address?.zip_code || '0000';
    const zonaData = await detectarZona(codigo_postal);

    const nuevoEnvio = new Envio({
      meli_id,
      sender_id,
      cliente_id: cliente._id,
      codigo_postal,
      zona: zonaData?.zona || 'No encontrada',
      datos_completos: datosEnvio
    });

    await nuevoEnvio.save();

    res.json({
      mensaje: 'Envío guardado con datos desde MeLi',
      zona: zonaData?.zona || 'No encontrada',
      cliente: {
        nombre: cliente.nombre,
        lista_precios: cliente.lista_precios
      },
      datos_envio: datosEnvio
    });

  } catch (err) {
    console.error('Error en escaneo MeLi:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al obtener el envío desde MeLi' });
  }
});

module.exports = router;

