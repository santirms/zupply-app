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

// === dentro de routes/client-panel.js ===

// Proyección mínima probando alias para tracking/fecha/estado/partido
const projection = {
  // tracking (varios alias)
  tracking: 1, tracking_id: 1, trackingId: 1,
  numero_seguimiento: 1, tracking_code: 1, tracking_meli: 1, shipment_id: 1,

  // id de venta
  id_venta: 1, order_id: 1, venta_id: 1,

  // fechas
  createdAt: 1, fecha: 1, created_at: 1,

  // destino/partido (sin geocodificar)
  'destino.partido': 1, 'destino.localidad': 1, 'zona.partido': 1,

  // estado
  estado: 1, status: 1
};

// Normalizador para la tabla (sin columna "Cliente")
function normalizeRow(doc) {
  const tracking =
    doc.tracking ??
    doc.tracking_id ??
    doc.trackingId ??
    doc.numero_seguimiento ??
    doc.tracking_code ??
    doc.tracking_meli ??
    doc.shipment_id ??
    null;

  const id_venta = doc.id_venta ?? doc.order_id ?? doc.venta_id ?? null;
  const createdAt = doc.createdAt ?? doc.fecha ?? doc.created_at ?? null;

  const partido =
    doc?.destino?.partido ??
    doc?.destino?.localidad ??
    doc?.zona?.partido ??
    null;

  // Normalizar estado y generar estilos de badge iguales al panel admin/coordinador
  const rawEstado = (doc.estado ?? doc.status ?? '').toString().toLowerCase();
  const estadoMap = {
    pendiente:   ['pendiente','nuevo','created','to_dispatch','ready'],
    en_camino:   ['en_camino','en camino','out_for_delivery','en_ruta','shipped'],
    entregado:   ['entregado','delivered','finalizado','closed','complete'],
    incidencia:  ['incidencia','failed','no_entregado','issue','problema'],
    reprogramado:['reprogramado','reprogrammed','rescheduled','postergado']
  };
  let estado = 'pendiente';
  for (const k of Object.keys(estadoMap)) {
    if (estadoMap[k].includes(rawEstado)) { estado = k; break; }
  }

  const estadoStyle = {
    pendiente:   'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    en_camino:   'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    entregado:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    incidencia:  'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    reprogramado:'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300'
  };

  return {
    _id: doc._id ? doc._id.toString() : null,
    tracking,
    id_venta,
    createdAt,
    destino: { partido },
    estado,
    estado_ui: {
      text: estado.replace('_',' '),
      class: 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + (estadoStyle[estado] || estadoStyle.pendiente)
    }
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

    const [docs, total] = await Promise.all([
      Envio.find(filter, projection).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Envio.countDocuments(filter)
    ]);
    const items = (docs || []).map(normalizeRow);
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
