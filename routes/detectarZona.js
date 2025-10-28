const express = require('express');
const router = express.Router();
const Partido = require('../models/partidos'); // Modelo con cp, localidad, partido
const Zona = require('../models/Zona');

router.post('/', async (req, res) => {
  const { codigo_postal } = req.body;

  try {
    // Buscar el partido correspondiente al CP
    const partidoData = await Partido.findOne({ codigo_postal });

    if (!partidoData) {
      return res.status(404).json({ error: 'Código postal no encontrado' });
    }

    const { partido } = partidoData;

    // Buscar zona a la que pertenece ese partido
    const zona = await Zona.findOne({ partidos: partido });

    if (!zona) {
      return res.status(404).json({ error: 'Zona no encontrada para este partido' });
    }

    res.json({
      zona: zona.nombre,
      precio: zona.precio
    });

  } catch (error) {
    console.error('Error detectando zona:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
