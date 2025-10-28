const express = require('express');
const router = express.Router();
const Zona = require('../models/Zona');
const Partido = require('../models/partidos'); // asumimos que ya cargaste los códigos postales

router.get('/:codigoPostal', async (req, res) => {
  try {
    const cp = req.params.codigoPostal;

    // 1. Buscar el partido y localidad correspondientes al CP
    const ubicacion = await Partido.findOne({ codigo_postal: cp });

    if (!ubicacion) {
      return res.status(404).json({ error: 'Código postal no encontrado' });
    }

    const { partido, localidad } = ubicacion;

    // 2. Buscar en qué zona está ese partido/localidad
    const zonas = await Zona.find();

    for (const zona of zonas) {
      for (const p of zona.partidos) {
        if (
          p.nombre === partido &&
          (
            p.localidades.length === 0 || // todo el partido
            p.localidades.includes(localidad)
          )
        ) {
          return res.json({ zona: zona.nombre, precio: zona.precio });
        }
      }
    }

    // Si no se encontró zona
    res.status(404).json({ error: 'Zona no encontrada para este código postal' });

  } catch (err) {
    console.error('Error detectando zona:', err);
    res.status(500).json({ error: 'Error interno al detectar zona' });
  }
});

module.exports = router;
