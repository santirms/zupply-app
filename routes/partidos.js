// routes/partidos.js
const express = require('express');
const router  = express.Router();
const Partido = require('../models/partidos');

// 1) GET /partidos/cp/:cp
//    Devuelve { partido } buscando en `codigo_postal`
router.get('/cp/:cp', async (req, res) => {
  try {
    const cpRaw = req.params.cp.trim();
    console.log('Buscando partido para CP:', cpRaw);

    // Primer intento: buscar como cadena exacta
    let partidoDoc = await Partido.findOne({ codigo_postal: cpRaw });

    // Si no, intentar como número (por si hubo conversión al guardar)
    if (!partidoDoc && !isNaN(Number(cpRaw))) {
      partidoDoc = await Partido.findOne({ codigo_postal: String(cpRaw) });
    }

    console.log('Resultado partidoDoc:', partidoDoc?.partido);
    return res.json({ partido: partidoDoc?.partido || null });
  } catch (err) {
    console.error('Error en GET /partidos/cp/:cp', err);
    return res.status(500).json({ error: 'Error al buscar partido por CP' });
  }
});

// 2) GET /partidos
//    Lista únicos de `partido` para panel-zonas-listas
router.get('/', async (req, res) => {
  try {
    const partidosUnicos = await Partido.aggregate([
      { $group: { _id: '$partido' } },
      { $sort: { _id: 1 } }
    ]);
    const lista = partidosUnicos.map(p => ({ nombre: p._id }));
    return res.json(lista);
  } catch (err) {
    console.error('Error en GET /partidos', err);
    return res.status(500).json({ error: 'Error al obtener partidos' });
  }
});

module.exports = router;

