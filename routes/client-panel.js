// routes/client-panel.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const { requireRole, applyClientScope } = require('../middlewares/auth');

// fallback por si applyClientScope no está exportado
function withClientScope(req, base = {}) {
  if (typeof applyClientScope === 'function') return applyClientScope(req, base);

  const u = req.session?.user;
  if (u?.role === 'cliente') {
    const sids = Array.isArray(u.sender_ids) ? u.sender_ids.map(String).filter(Boolean) : [];
    return { ...base, sender_id: { $in: sids.length ? sids : ['__none__'] } };
  }
  return base;
}

// Si NO es cliente, permitir scoping por query (?sender=ID1,ID2) para admins/coordinadores;
// si no viene, devolvemos vacío (evita descargar toda la colección por error).
function applyScopeForAnyRole(req, base = {}) {
  const u = req.session?.user;
  let filter = withClientScope(req, base);
  let scoped = u?.role === 'cliente';

  if (!scoped && (u?.role === 'admin' || u?.role === 'coordinador')) {
    const sender = (req.query.sender_id || req.query.sender || '').trim();
    if (sender) {
      const arr = sender.split(',').map(s => s.trim()).filter(Boolean).map(String);
      filter = { ...filter, sender_id: { $in: arr } };
      scoped = true;
    }
  }
  return { filter, scoped };
}

// 1) Tabla
router.get('/shipments', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit||'50',10), 200);
    const page  = Math.max(parseInt(req.query.page||'1',10), 1);
    const skip  = (page - 1) * limit;

    let baseFilter = {};
    if (req.query.estado) baseFilter.estado = String(req.query.estado);
    if (req.query.desde || req.query.hasta) {
      baseFilter.createdAt = {};
      if (req.query.desde) baseFilter.createdAt.$gte = new Date(req.query.desde);
      if (req.query.hasta) baseFilter.createdAt.$lte = new Date(req.query.hasta);
    }

    const { filter, scoped } = applyScopeForAnyRole(req, baseFilter);
    console.log('[CLIENT-PANEL] filter:', filter, 'scoped:', scoped);

    if (!scoped) {
      // Nada de scope => vaciamos de forma explícita
      return res.json({ items: [], page, limit, total: 0, note: 'No scope (cliente sin sender_ids o admin sin ?sender=)' });
    }

    const projection = {
      tracking: 1,
      id_venta: 1,
      cliente_nombre: 1,
      createdAt: 1,
      'destino.partido': 1,
      estado: 1
    };

    const [items, total] = await Promise.all([
      Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Envio.countDocuments(filter)
    ]);

    // logs seguros
    console.log('[CLIENT-PANEL] returning', { count: Array.isArray(items) ? items.length : 0, page, limit, total });

    res.json({ items: Array.isArray(items) ? items : [], page, limit, total });
  } catch (e) {
    console.error('client-panel /shipments error:', e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// 2) Mapa
router.get('/shipments/map', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    let baseFilter = {};
    const { swLat, swLng, neLat, neLng, estado } = req.query;

    if (swLat && swLng && neLat && neLng) {
      baseFilter['destino.loc'] = {
        $geoWithin: {
          $box: [
            [parseFloat(swLng), parseFloat(swLat)],
            [parseFloat(neLng), parseFloat(neLat)]
          ]
        }
      };
    }
    if (estado) baseFilter.estado = String(estado);

    const { filter, scoped } = applyScopeForAnyRole(req, baseFilter);
    console.log('[CLIENT-PANEL MAP] filter:', filter, 'scoped:', scoped);

    if (!scoped) {
      return res.json({ items: [], limit: 0, note: 'No scope (cliente sin sender_ids o admin sin ?sender=)' });
    }

    const projection = {
      _id: 1,
      tracking: 1,
      estado: 1,
      'destino.partido': 1,
      'destino.loc': 1
    };

    const limit = Math.min(parseInt(req.query.limit||'500',10), 1000);
    const items = await Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();

    console.log('[CLIENT-PANEL MAP] returning', { count: Array.isArray(items) ? items.length : 0 });

    res.json({ items: Array.isArray(items) ? items : [], limit });
  } catch (e) {
    console.error('client-panel /shipments/map error:', e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

module.exports = router;
