const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const { requireAuth, requireRole } = require('../middlewares/auth');

router.use(requireAuth, requireRole('chofer'));

router.get('/del-dia', async (req, res, next) => {
  try {
    const { driver_id } = req.session.user;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const mañana = new Date(hoy); mañana.setDate(hoy.getDate() + 1);

    const envios = await Envio.find({
      chofer_id: driver_id,         // asegúrate de tener este campo
      createdAt: { $gte: hoy, $lt: mañana }
    }).lean();
    res.json({ envios });
  } catch (e) { next(e); }
});

router.patch('/:id/entregar', async (req, res, next) => {
  try {
    const { driver_id } = req.session.user;
    const envio = await Envio.findById(req.params.id).select('chofer_id source');
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    if (String(envio.chofer_id) !== String(driver_id)) {
      return res.status(403).json({ error: 'No es tu envío' });
    }
    const permitidas = ['panel','scan','pdf','etiqueta'];
    if (!permitidas.includes(envio.source)) {
      return res.status(403).json({ error: 'Este envío no puede ser modificado por chofer' });
    }

    await Envio.findByIdAndUpdate(req.params.id, {
      estado: 'entregado',
      $push: { historial: { at: new Date(), estado: 'entregado', source: 'panel', actor_name: 'chofer' } }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
