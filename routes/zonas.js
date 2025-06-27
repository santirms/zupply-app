const express = require('express');
const router = express.Router();
const Zona = require('../models/Zona');

router.get('/', async (req, res) => {
  const zonas = await Zona.find();
  res.json(zonas);
});

router.post('/', async (req, res) => {
  try {
    const nueva = new Zona(req.body);
    await nueva.save();
    res.status(201).json(nueva);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Zona.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Zona eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;