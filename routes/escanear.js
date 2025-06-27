const express = require('express');
const router = express.Router();
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const detectarZona = require('../utils/detectarZona');

router.post('/manual', async (req, res) => {
  try {
    const { meli_id, sender_id, codigo_postal } = req.body;

    if (!meli_id || !sender_id || !codigo_postal) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    // Buscar cliente
    const cliente = await Cliente.findOne({ sender_id });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Detectar zona
    const zonaData = await detectarZona(codigo_postal);

    // Crear envío
    const nuevoEnvio = new Envio({
      meli_id,
      sender_id,
      cliente_id: cliente._id,
      codigo_postal,
      zona: zonaData?.zona || 'No encontrada'
    });

    await nuevoEnvio.save();

    res.json({
    mensaje: 'Envío guardado',
    cliente: {
    nombre: cliente.nombre,
    lista_precios: cliente.lista_precios
  },
  zona: zonaData?.zona || 'No encontrada'
    });

  } catch (err) {
    console.error("Error en escaneo manual:", err);
    res.status(500).json({ error: 'Error al guardar envío' });
  }
});

module.exports = router;
