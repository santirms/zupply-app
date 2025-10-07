const express = require('express');
const router = express.Router();
const ZonaRack = require('../models/ZonaRack');
const Envio = require('../models/Envio');

// GET todas las zonas configuradas
router.get('/', async (req, res) => {
  try {
    const zonas = await ZonaRack.find({ activo: true }).sort({ orden: 1 });
    res.json(zonas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST crear/actualizar zona
router.post('/', async (req, res) => {
  try {
    const { _id, nombre, partidos, orden } = req.body;

    const partidosUsados = await ZonaRack.find({
      _id: { $ne: _id },
      partidos: { $in: partidos }
    });

    if (partidosUsados.length > 0) {
      return res.status(400).json({
        error: 'Partidos ya asignados',
        conflicto: partidosUsados[0].nombre
      });
    }

    if (_id) {
      const zona = await ZonaRack.findByIdAndUpdate(
        _id,
        { nombre, partidos, orden },
        { new: true }
      );
      res.json(zona);
    } else {
      const zona = await ZonaRack.create({ nombre, partidos, orden });
      res.json(zona);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE eliminar zona
router.delete('/:id', async (req, res) => {
  try {
    await ZonaRack.findByIdAndUpdate(req.params.id, { activo: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET KPIs de una zona específica por estado
router.get('/:id/kpi', async (req, res) => {
  try {
    const zona = await ZonaRack.findById(req.params.id);
    if (!zona) return res.status(404).json({ error: 'Zona no encontrada' });

    const { estado } = req.query; // 'pendiente' o 'en_camino'

    if (!estado || !['pendiente', 'en_camino'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser pendiente o en_camino' });
    }

    // Filtro SIN restricción temporal - TODOS los envíos del estado
    const filtro = {
      partido: { $in: zona.partidos },
      estado: estado
    };

    const total = await Envio.countDocuments(filtro);

    res.json({ total, estado });
  } catch (e) {
    console.error('KPI zona error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
