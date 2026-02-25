const express = require('express');
const router = express.Router();
const Zona = require('../models/Zona');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar middleware de tenant a todas las rutas
router.use(identifyTenant);

// Obtener todas las zonas
router.get('/', async (req, res) => {
  const zonas = await Zona.find({ tenantId: req.tenantId });
  res.json(zonas);
});

// Crear zona
router.post('/', async (req, res) => {
  try {
    const nuevaZona = new Zona({
      nombre: req.body.nombre,
      partidos: req.body.partidos,
      tenantId: req.tenantId
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
    await Zona.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId
    });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar zona' });
  }
});

// Editar zona (nombre + partidos)
router.put('/:id', async (req, res) => {
  try {
    const update = {};
    if (req.body.nombre) update.nombre = req.body.nombre;
    if (req.body.partidos) update.partidos = req.body.partidos;

    const zona = await Zona.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      update,
      { new: true }
    );
    if (!zona) return res.status(404).json({ error: 'Zona no encontrada' });
    res.json(zona);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
