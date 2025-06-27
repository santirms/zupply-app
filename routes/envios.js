const Cliente = require('../models/cliente');
const express = require('express');
const router = express.Router();
const Envio = require('../models/Envio');

// Obtener todos los envíos con filtros opcionales
router.get('/', async (req, res) => {
  try {
    const { sender_id, desde, hasta } = req.query;
    const filtro = {};

    if (sender_id) filtro.sender_id = sender_id;

    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = new Date(desde);
      if (hasta) filtro.fecha.$lte = new Date(hasta);
    }

    const envios = await Envio.find(filtro).populate('cliente_id');
    res.json(envios);
  } catch (err) {
    console.error('Error al filtrar envíos:', err);
    res.status(500).json({ error: 'Error al obtener envíos' });
  }
});

// Guardar envíos de forma masiva (desde carga manual)
router.post('/guardar-masivo', async (req, res) => {
  try {
    const paquetes = req.body;

    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes para guardar.' });
    }

    const cliente = await Cliente.findById(paquetes[0].clienteId); // Suponés que todos los paquetes son del mismo cliente

    if (!cliente) {
      return res.status(400).json({ error: 'Cliente no encontrado.' });
    }

    const enviosFormateados = paquetes.map(p => ({
      cliente_id: p.clienteId,
      sender_id: cliente.sender_id[0] || '', // asegurando que sea string // 👈 clave para que no falle el schema
      direccion: p.direccion || '',
      destinatario: p.destinatario || '',
      codigo_postal: p.cp,
      id_venta: p.idVenta || '',
      zona: p.zona,
      estado: 'pending',
      fecha: new Date()
    }));

    const resultado = await Envio.insertMany(enviosFormateados);
    res.status(201).json(resultado);
  } catch (err) {
    console.error('Error al guardar envíos masivos:', err);
    res.status(500).json({ error: 'Error al guardar envíos' });
  }
});

module.exports = router;
