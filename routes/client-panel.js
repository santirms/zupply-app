// routes/client-panel.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');

const { requireRole, applyClientScope } = require('../middlewares/auth');

// Fallback por si en caliente no lo encuentra (evita romper prod)
const withClientScope = (req, base = {}) => {
  if (typeof applyClientScope === 'function') return applyClientScope(req, base);
  const u = req.session?.user;
  if (u?.role === 'cliente') {
    const sids = Array.isArray(u.sender_ids) ? u.sender_ids.filter(Boolean) : [];
    return { ...base, sender_id: { $in: sids.length ? sids : ['__none__'] } };
  }
  return base;
};

// 1) Tabla: Tracking | Id de venta | Cliente | Fecha | Partido | Estado
router.get('/shipments', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit||'50',10), 200);
    const page  = Math.max(parseInt(req.query.page||'1',10), 1);
    const skip  = (page - 1) * limit;

    let filter = {};
    // filtros opcionales
    if (req.query.estado) filter.estado = String(req.query.estado);
    if (req.query.desde || req.query.hasta) {
      filter.createdAt = {};
      if (req.query.desde) filter.createdAt.$gte = new Date(req.query.desde);
      if (req.query.hasta) filter.createdAt.$lte = new Date(req.query.hasta);
    }

    filter = withClientScope(req, filter);

    // proyección mínima
    const projection = {
      tracking: 1,
      id_venta: 1,
      cliente_nombre: 1, // denormalizado al guardar
      createdAt: 1,
      'destino.partido': 1,
      estado: 1
    };

    const [items, total] = await Promise.all([
      console.log('[CLIENT-PANEL] user:', req.session?.user);
      console.log('[CLIENT-PANEL] filter:', filter);
      Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Envio.countDocuments(filter)
    ]);

    res.json({ items, page, limit, total });
  } catch (e) {
    console.error('client-panel /shipments error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// 2) Mapa: puntos livianos con bounds (no saturar DB)
router.get('/shipments/map', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    let filter = applyClientScope(req, {});
    const { swLat, swLng, neLat, neLng, estado } = req.query;

    if (swLat && swLng && neLat && neLng) {
      filter['destino.loc'] = {
        $geoWithin: {
          $box: [
            [parseFloat(swLng), parseFloat(swLat)],
            [parseFloat(neLng), parseFloat(neLat)]
          ]
        }
      };
    }
    if (estado) filter.estado = String(estado);

    const projection = {
      _id: 1,
      tracking: 1,
      estado: 1,
      'destino.partido': 1,
      'destino.loc': 1
    };

    const limit = Math.min(parseInt(req.query.limit||'500',10), 1000);

    const items = await Envio.find(filter, projection)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    res.json({ items, limit });
  } catch (e) {
    console.error('client-panel /shipments/map error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
