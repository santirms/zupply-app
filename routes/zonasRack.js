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

// GET KPIs de una zona específica (13hs ayer → 13hs hoy)
router.get('/:id/kpi', async (req, res) => {
  try {
    const zona = await ZonaRack.findById(req.params.id);
    if (!zona) return res.status(404).json({ error: 'Zona no encontrada' });

    const now = new Date();
    const ayer13hs = new Date(now);
    ayer13hs.setDate(ayer13hs.getDate() - 1);
    ayer13hs.setHours(13, 0, 0, 0);

    const hoy13hs = new Date(now);
    hoy13hs.setHours(13, 0, 0, 0);

    const filtro = {
      partido: { $in: zona.partidos },
      estado: { $in: ['pendiente', 'en_camino'] },
      fecha: { $gte: ayer13hs, $lte: hoy13hs }
    };

    const [pendientes, en_camino, total] = await Promise.all([
      Envio.countDocuments({ ...filtro, estado: 'pendiente' }),
      Envio.countDocuments({ ...filtro, estado: 'en_camino' }),
      Envio.countDocuments(filtro)
    ]);

    res.json({ pendientes, en_camino, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
