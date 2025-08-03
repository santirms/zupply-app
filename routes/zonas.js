const express = require('express');
const router = express.Router();
const Zona = require('../models/zona');

// Obtener todas las zonas
router.get('/', async (req, res) => {
  const zonas = await Zona.find();
  res.json(zonas);
});

// Crear zona
router.post('/', async (req, res) => {
  try {
    const nuevaZona = new Zona({
      nombre: req.body.nombre,
      partidos: req.body.partidos
    });
    await nuevaZona.save();
    res.status(201).json(nuevaZona);
  } catch (err) {
    console.error('Error creando zona:', err);
    res.status(400).json({ error: err.message });
  }
});

// Eliminar zona
router.delete('/:id', async (req, res) => {
  try {
    await Zona.findByIdAndDelete(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar zona' });
  }
});

// Editar zona (solo nombre en este caso)
router.put('/:id', async (req, res) => {
  try {
    await Zona.findByIdAndUpdate(req.params.id, { nombre: req.body.nombre });
    res.status(200).json({ message: 'Zona actualizada' });
  } catch (err) {
    res.status(500).json({ error: 'Error al editar zona' });
  }
});

module.exports = router;
