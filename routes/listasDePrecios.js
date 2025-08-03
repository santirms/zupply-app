const express = require('express');
const router = express.Router();
const ListaDePrecios = require('../models/listaDePrecios');

// Crear nueva lista
router.post('/', async (req, res) => {
  try {

    console.log("Datos recibidos:", req.body); // <-- Agregado

    const nuevaLista = new ListaDePrecios(req.body);
    await nuevaLista.save();
    res.status(201).json(nuevaLista);
  } catch (err) {
    console.error("Error al crear lista:", err);
    res.status(500).json({ error: 'Error al guardar la lista de precios' });
  }
});

// Obtener todas
router.get('/', async (req, res) => {
  try {
    const listas = await ListaDePrecios.find().populate('zonas.zona');
    res.json(listas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar
router.put('/:id', async (req, res) => {
  try {
    const actualizada = await ListaDePrecios.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(actualizada);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar
router.delete('/:id', async (req, res) => {
  try {
    await ListaDePrecios.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Lista eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
