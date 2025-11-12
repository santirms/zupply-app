// routes/partidos.js
const express = require('express');
const router  = express.Router();
const Partido = require('../models/partidos');

// 1) GET /partidos/cp/:cp
//    Devuelve información completa del código postal
router.get('/cp/:cp', async (req, res) => {
  try {
    const cpRaw = req.params.cp.trim();
    console.log('Buscando partido para CP:', cpRaw);

    // Validar formato (4 dígitos)
    if (!/^\d{4}$/.test(cpRaw)) {
      return res.status(400).json({
        valido: false,
        error: 'Código postal debe tener 4 dígitos numéricos'
      });
    }

    // Buscar en codigo_postal (String)
    let partidoDoc = await Partido.findOne({ codigo_postal: cpRaw });

    // Si no encontró, buscar en el array codigos_postales
    if (!partidoDoc) {
      partidoDoc = await Partido.findOne({ codigos_postales: cpRaw });
    }

    // Si no encontró, intentar con conversión a número
    if (!partidoDoc && !isNaN(Number(cpRaw))) {
      partidoDoc = await Partido.findOne({ codigo_postal: String(cpRaw) });
    }

    console.log('Resultado partidoDoc:', partidoDoc?.partido);

    if (partidoDoc) {
      return res.json({
        valido: true,
        partido: partidoDoc.partido,
        localidad: partidoDoc.localidad || partidoDoc.partido,
        zona: partidoDoc.zona || null,
        codigo_postal: cpRaw
      });
    } else {
      return res.json({
        valido: false,
        mensaje: 'Código postal no está en nuestra zona de cobertura',
        codigo_postal: cpRaw
      });
    }
  } catch (err) {
    console.error('Error en GET /partidos/cp/:cp', err);
    return res.status(500).json({
      valido: false,
      error: 'Error al buscar partido por CP'
    });
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

