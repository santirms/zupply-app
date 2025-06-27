const express = require('express');
const router = express.Router();
const Tarifa = require('../models/Tarifa');

router.get('/', async (req, res) => {
  const tarifas = await Tarifa.find().populate('zona_id');
  res.json(tarifas);
});

router.post('/', async (req, res) => {
  try {
    const nueva = new Tarifa(req.body);
    await nueva.save();
    res.status(201).json(nueva);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Tarifa.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Tarifa eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;