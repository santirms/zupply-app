// routes/client-panel.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const logger  = require('../utils/logger');
const { obtenerShipmentsPanelCliente } = require('../controllers/envioController');
const { requireAuth, requireRole } = require('../middlewares/auth');

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
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return null;
  const [, y, m, d] = parts;
  return new Date(`${y}-${m}-${d}T00:00:00.000-03:00`);
}

function parseDateEnd(value) {
  if (!value) return null;
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return null;
  const [, y, m, d] = parts;
  return new Date(`${y}-${m}-${d}T23:59:59.999-03:00`);
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

router.get('/shipments', requireAuth, requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    await obtenerShipmentsPanelCliente(req, res);
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

// Excel export endpoint
const ExcelJS = require('exceljs');

router.get('/shipments/export', requireAuth, requireRole('cliente','admin','coordinador'), async (req, res) => {
  try {
    const { estado, desde, hasta, destinatario, direccion } = req.query;

    const u = req.session?.user;
    const senderIdsRaw = u?.sender_ids || [];
    const senderIds = Array.isArray(senderIdsRaw)
      ? senderIdsRaw.filter(Boolean).map((id) => String(id))
      : typeof senderIdsRaw === 'string' ? [senderIdsRaw] : [];

    if (!senderIds.length) {
      return res.status(400).json({ error: 'Sin sender_ids configurados' });
    }

    const query = {
      sender_id: { $in: senderIds }
    };

    const start = desde ? new Date(desde + 'T00:00:00.000-03:00') : null;
    const end = hasta ? new Date(hasta + 'T23:59:59.999-03:00') : null;
    if (start || end) {
      query.fecha = {};
      if (start) query.fecha.$gte = start;
      if (end) query.fecha.$lte = end;
    } else {
      const hace2Semanas = new Date();
      hace2Semanas.setDate(hace2Semanas.getDate() - 14);
      hace2Semanas.setHours(0, 0, 0, 0);
      query.fecha = { $gte: hace2Semanas };
    }

    if (estado && estado !== 'todos') query.estado = estado;
    if (destinatario) query.destinatario = { $regex: destinatario, $options: 'i' };
    if (direccion) query.direccion = { $regex: direccion, $options: 'i' };

    const envios = await Envio.find(query)
      .select('id_venta tracking meli_id destinatario direccion partido codigo_postal estado fecha sender_id')
      .sort({ fecha: -1 })
      .limit(5000)
      .lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Envíos');

    sheet.columns = [
      { header: 'ID / Tracking', key: 'tracking', width: 22 },
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Destinatario', key: 'destinatario', width: 28 },
      { header: 'Dirección', key: 'direccion', width: 35 },
      { header: 'Partido', key: 'partido', width: 18 },
      { header: 'CP', key: 'cp', width: 8 },
      { header: 'Estado', key: 'estado', width: 18 },
    ];

    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
      cell.alignment = { horizontal: 'center' };
    });

    for (const e of envios) {
      const fechaStr = e.fecha
        ? new Date(e.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
        : '-';
      sheet.addRow({
        tracking: e.id_venta || e.tracking || e.meli_id || '-',
        fecha: fechaStr,
        destinatario: e.destinatario || '-',
        direccion: e.direccion || '-',
        partido: e.partido || '-',
        cp: e.codigo_postal || '-',
        estado: e.estado || '-',
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="envios-${new Date().toISOString().split('T')[0]}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[client-panel/export] error:', err);
    res.status(500).json({ error: 'Error generando Excel' });
  }
});

module.exports = router;
