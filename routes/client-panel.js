// routes/client-panel.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const logger  = require('../utils/logger');
const { requireRole } = require('../middlewares/auth');

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
function combineConditions(conditions = []) {
  const valid = conditions.filter((cond) => cond && Object.keys(cond).length);
  if (!valid.length) return {};
  if (valid.length === 1) return valid[0];
  return { $and: valid };
}

function getScopedFilter(req, base = {}) {
  const u = req.session?.user;
  const conditions = [];
  if (base && Object.keys(base).length) {
    conditions.push(base);
  }

  if (u?.role === 'cliente') {
    const clienteId = u.cliente_id || u._id || null;
    if (!clienteId) {
      return { filter: { _id: { $in: [] } }, reason: 'cliente-sin-cliente', clienteId: null };
    }
    conditions.push({ cliente_id: clienteId });
    return { filter: combineConditions(conditions), reason: 'cliente', clienteId };
  }

  if (u?.role === 'admin' || u?.role === 'coordinador') {
    const clienteParam = (req.query.cliente_id || req.query.clienteId || req.query.cliente || '').trim();
    if (!clienteParam) {
      return { filter: { _id: { $in: [] } }, reason: 'admin-sin-cliente', clienteId: null };
    }
    conditions.push({ cliente_id: clienteParam });

    const senderParam = (req.query.sender || req.query.sender_id || '').trim();
    if (senderParam) {
      const sids = senderParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (sids.length) {
        conditions.push(buildSenderFilter(sids));
      }
    }

    return { filter: combineConditions(conditions), reason: 'admin/coordinador', clienteId: clienteParam };
  }

  return { filter: { _id: { $in: [] } }, reason: 'otro-rol', clienteId: null };
}

function parseDateStart(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseDateEnd(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function buildFechaRange(query = {}) {
  const start = parseDateStart(query.desde);
  const end = parseDateEnd(query.hasta);
  if (start || end) {
    const range = {};
    if (start) range.$gte = start;
    if (end) range.$lte = end;
    return range;
  }
  const hace2Semanas = new Date();
  hace2Semanas.setDate(hace2Semanas.getDate() - 14);
  hace2Semanas.setHours(0, 0, 0, 0);
  return { $gte: hace2Semanas };
}

// === dentro de routes/client-panel.js ===

router.get('/shipments', requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit||'50',10), 200);
    const page  = Math.max(parseInt(req.query.page||'1',10), 1);
    const skip  = (page - 1) * limit;

    const estado = (req.query.estado || '').toString().trim();
    const base = {};
    if (estado) base.estado = estado;

    const { filter, reason, clienteId } = getScopedFilter(req, base);

    if (!clienteId) {
      if (reason === 'admin-sin-cliente') {
        return res.status(400).json({ error: 'missing_cliente_id' });
      }
      return res.json({ items: [], page, limit, total: 0 });
    }

    const condiciones = [];
    if (filter && Array.isArray(filter.$and)) {
      condiciones.push(...filter.$and);
    } else if (filter && Object.keys(filter).length) {
      condiciones.push(filter);
    }

    const rangoFechas = buildFechaRange(req.query);
    const fechaCond = {};
    if (rangoFechas.$gte) fechaCond.$gte = rangoFechas.$gte;
    if (rangoFechas.$lte) fechaCond.$lte = rangoFechas.$lte;

    const createdCond = {};
    if (rangoFechas.$gte) createdCond.$gte = rangoFechas.$gte;
    if (rangoFechas.$lte) createdCond.$lte = rangoFechas.$lte;

    condiciones.push({
      $or: [
        { fecha: fechaCond },
        {
          $and: [
            { $or: [ { fecha: { $exists: false } }, { fecha: null } ] },
            { createdAt: createdCond }
          ]
        }
      ]
    });

    const finalFilter = condiciones.length === 1 ? condiciones[0] : { $and: condiciones };

    const projection = {
      tracking: 1,
      tracking_id: 1,
      trackingId: 1,
      numero_seguimiento: 1,
      tracking_code: 1,
      tracking_meli: 1,
      shipment_id: 1,
      id_venta: 1,
      order_id: 1,
      venta_id: 1,
      meli_id: 1,
      destinatario: 1,
      nombre_destinatario: 1,
      direccion: 1,
      partido: 1,
      codigo_postal: 1,
      estado: 1,
      estado_meli: 1,
      fecha: 1,
      createdAt: 1,
      created_at: 1,
      updatedAt: 1,
      telefono: 1,
      telefono_destinatario: 1,
      referencia: 1,
      historial: 1,
      historial_estados: 1,
      timeline: 1,
      destino: 1,
      chofer: 1,
      cliente_id: 1,
      sender_id: 1
    };

    const [docs, total] = await Promise.all([
      Envio.find(finalFilter, projection)
        .populate('chofer', 'nombre email telefono')
        .sort({ fecha: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Envio.countDocuments(finalFilter)
    ]);

    const items = (docs || []).map((doc) => {
      if (!doc.partido) {
        doc.partido = doc?.destino?.partido || doc?.destino?.localidad || null;
      }
      if (!doc.destinatario) {
        doc.destinatario = doc.nombre_destinatario || doc?.destino?.nombre || null;
      }
      if (!doc.telefono && doc.telefono_destinatario) {
        doc.telefono = doc.telefono_destinatario;
      }
      return doc;
    });

    logger.info('[Panel Cliente] Envíos obtenidos', {
      cliente_id: clienteId ? String(clienteId) : null,
      page,
      limit,
      count: items.length,
      total,
      reason
    });

    res.json({ items, page, limit, total });
  } catch (e) {
    logger.error('client-panel /shipments error:', e);
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
    logger.debug('[CLIENT-PANEL MAP] filtro aplicado', { reason, filter });

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
    logger.error('client-panel /shipments/map error:', e);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

router.get('/_debug/senders', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const agg = await Envio.aggregate([
      {
        $project: {
          s_id:  '$sender_id',
          sId:   '$senderId',
          s:     '$sender',
          t_id:  { $type: '$sender_id' },
          tId:   { $type: '$senderId' },
          t:     { $type: '$sender' }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          sender_id_examples: { $addToSet: { v: '$s_id', t: '$t_id' } },
          senderId_examples:  { $addToSet: { v: '$sId',  t: '$tId'  } },
          sender_examples:    { $addToSet: { v: '$s',    t: '$t'    } }
        }
      }
    ]).exec();
    res.json(agg[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// routes/client-panel.js (debajo del otro _debug)
router.get('/_debug/senders/list', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const q = (req.query.q || '').trim(); // prefijo opcional
    const match = q ? { sender_id: { $regex: '^' + q, $options: 'i' } } : {};
    const agg = await Envio.aggregate([
      { $match: match },
      { $group: { _id: '$sender_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 200 }
    ]).exec();
    res.json({ items: agg.map(x => ({ sender_id: x._id, count: x.count })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
