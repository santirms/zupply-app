// routes/client-panel.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const { requireRole, applyClientScope } = require('../middlewares/auth');

function buildSenderFilter(senderIds) {
  // aceptá strings y numbers en la DB
  const asStr = senderIds.map(s => String(s));
  const asNum = senderIds
    .map(s => Number(s))
    .filter(n => Number.isFinite(n));

  // soportá distintos nombres posibles del campo
  const or = [];
  if (asStr.length) {
    or.push({ sender_id: { $in: asStr } });
    or.push({ senderId:   { $in: asStr } });
    or.push({ sender:     { $in: asStr } });
  }
  if (asNum.length) {
    or.push({ sender_id: { $in: asNum } });
    or.push({ senderId:   { $in: asNum } });
    or.push({ sender:     { $in: asNum } });
  }
  // si nada matchea, devolvé un filtro imposible
  return or.length ? { $or: or } : { _id: { $in: [] } };
}

// Scope helper estricto
function getScopedFilter(req, base = {}) {
  const u = req.session?.user;
  if (u?.role === 'cliente') {
    const sids = Array.isArray(u.sender_ids) ? u.sender_ids.filter(Boolean) : [];
    if (!sids.length) return { filter: { _id: { $in: [] } }, reason: 'cliente-sin-senders' };
    return { filter: { ...base, ...buildSenderFilter(sids) }, reason: 'cliente' };
  }
  if (u?.role === 'admin' || u?.role === 'coordinador') {
    const senderParam = (req.query.sender || req.query.sender_id || '').trim();
    if (!senderParam) return { filter: { _id: { $in: [] } }, reason: 'admin-sin-sender-param' };
    const sids = senderParam.split(',').map(s => s.trim()).filter(Boolean);
    return { filter: { ...base, ...buildSenderFilter(sids) }, reason: 'admin/coordinador' };
  }
  return { filter: { _id: { $in: [] } }, reason: 'otro-rol' };
}

// Normalizador de columnas para la tabla
function normalizeRow(doc) {
  // adaptá aquí si tus campos reales tienen otros nombres
  const tracking = doc.tracking ?? doc.tracking_id ?? doc.numero_seguimiento ?? null;
  const id_venta = doc.id_venta ?? doc.order_id ?? doc.venta_id ?? null;
  const cliente_nombre = doc.cliente_nombre ?? doc?.cliente?.nombre ?? null;
  const createdAt = doc.createdAt ?? doc.fecha ?? doc.created_at ?? null;
  const partido = doc?.destino?.partido ?? doc?.destino?.localidad ?? doc?.zona?.partido ?? null;
  const estado = doc.estado ?? doc.status ?? null;

  return {
    tracking,
    id_venta,
    cliente_nombre,
    createdAt,
    destino: { partido },
    estado
  };
}

// ─────────────────────────────────────────────────────────────────────────────

router.get('/shipments', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit||'50',10), 200);
    const page  = Math.max(parseInt(req.query.page||'1',10), 1);
    const skip  = (page - 1) * limit;

    let base = {};
    if (req.query.estado) base.estado = String(req.query.estado);
    if (req.query.desde || req.query.hasta) {
      base.createdAt = {};
      if (req.query.desde) base.createdAt.$gte = new Date(req.query.desde);
      if (req.query.hasta) base.createdAt.$lte = new Date(req.query.hasta);
    }

    const { filter, reason } = getScopedFilter(req, base);
    console.log('[CLIENT-PANEL] filter:', filter, 'reason:', reason);

    const projection = {
      tracking: 1, tracking_id: 1, numero_seguimiento: 1,
      id_venta: 1, order_id: 1, venta_id: 1,
      cliente_nombre: 1, 'cliente.nombre': 1,
      createdAt: 1, fecha: 1, created_at: 1,
      'destino.partido': 1, 'destino.localidad': 1, 'zona.partido': 1,
      estado: 1, status: 1,
      sender_id: 1
    };

    const [docs, total] = await Promise.all([
      Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Envio.countDocuments(filter)
    ]);

    const items = Array.isArray(docs) ? docs.map(normalizeRow) : [];
    res.json({ items, page, limit, total });
  } catch (e) {
    console.error('client-panel /shipments error:', e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

router.get('/shipments/map', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    let base = {};
    const { swLat, swLng, neLat, neLng, estado } = req.query;
    if (swLat && swLng && neLat && neLng) {
      base['destino.loc'] = {
        $geoWithin: { $box: [[parseFloat(swLng), parseFloat(swLat)], [parseFloat(neLng), parseFloat(neLat)]] }
      };
    }
    if (estado) base.estado = String(estado);

    const { filter, reason } = getScopedFilter(req, base);
    console.log('[CLIENT-PANEL MAP] filter:', filter, 'reason:', reason);

    const projection = {
      _id: 1,
      tracking: 1, tracking_id: 1,
      estado: 1, status: 1,
      'destino.partido': 1, 'destino.loc': 1
    };

    const limit = Math.min(parseInt(req.query.limit||'500',10), 1000);
    const docs = await Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();

    // normalización mínima para popup
    const items = (docs||[]).map(d => ({
      _id: d._id,
      tracking: d.tracking ?? d.tracking_id ?? null,
      estado: d.estado ?? d.status ?? null,
      destino: { partido: d?.destino?.partido, loc: d?.destino?.loc }
    }));

    res.json({ items, limit });
  } catch (e) {
    console.error('client-panel /shipments/map error:', e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

module.exports = router;
