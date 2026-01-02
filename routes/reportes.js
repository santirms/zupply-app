// routes/reportes.js
const express = require('express');
const router = express.Router();
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { requireAuth, requireRole } = require('../middlewares/auth');
const XLSX = require('xlsx');
const logger = require('../utils/logger');

/**
 * GET /api/reportes/generar
 * Query params:
 *   - clientes: 'all' o 'id1,id2,...'
 *   - estados: 'estado1,estado2,...'
 *   - desde: 'YYYY-MM-DD'
 *   - hasta: 'YYYY-MM-DD'
 *   - formato: 'xls' | 'pdf' | 'preview'
 *   - incluirHistorial: 'true' | 'false'
 *   - incluirIntentos: 'true' | 'false'
 *   - incluirCoordenadas: 'true' | 'false'
 */
router.get('/generar', requireAuth, requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const {
      clientes,
      estados,
      desde,
      hasta,
      formato = 'xls',
      incluirHistorial,
      incluirIntentos,
      incluirCoordenadas
    } = req.query;

    // Validaciones
    if (!estados || !desde || !hasta) {
      return res.status(400).json({ error: 'Parámetros requeridos: estados, desde, hasta' });
    }

    const dtFrom = new Date(desde);
    const dtTo = new Date(hasta);
    dtTo.setHours(23, 59, 59, 999); // Incluir todo el día "hasta"

    if (isNaN(dtFrom) || isNaN(dtTo)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }

    // Preparar filtro de clientes
    let clientesDocs = [];
    if (clientes === 'all' || !clientes) {
      clientesDocs = await Cliente.find({}).select('nombre sender_id').lean();
    } else {
      const ids = String(clientes).split(',').map(s => s.trim()).filter(Boolean);
      clientesDocs = await Cliente.find({ _id: { $in: ids } })
        .select('nombre sender_id').lean();
    }

    const clientesMap = new Map(clientesDocs.map(c => [String(c._id), c]));

    // Preparar filtro OR por cliente_id y sender_id
    const ors = [];
    for (const c of clientesDocs) {
      ors.push({ cliente_id: c._id });
      for (const s of (c.sender_id || [])) {
        ors.push({ sender_id: s });
      }
    }

    if (!ors.length) {
      return res.json({ items: [], total: 0 });
    }

    // Preparar filtro de estados
    const estadosArray = String(estados).split(',').map(s => s.trim()).filter(Boolean);

    // Query de envíos
    const query = {
      fecha: { $gte: dtFrom, $lte: dtTo },
      estado: { $in: estadosArray },
      $or: ors
    };

    let selectFields = 'id_venta meli_id tracking cliente_id sender_id destinatario direccion piso_dpto partido codigo_postal telefono estado fecha referencia';

    if (incluirHistorial === 'true') selectFields += ' historial';
    if (incluirIntentos === 'true') selectFields += ' intentosFallidos';
    if (incluirCoordenadas === 'true') selectFields += ' latitud longitud';

    const envios = await Envio.find(query)
      .select(selectFields)
      .sort({ fecha: -1 })
      .populate('cliente_id', 'nombre')
      .lean();

    // Procesar datos
    const items = envios.map(e => {
      const cliente = e.cliente_id?.nombre || clientesMap.get(String(e.cliente_id))?.nombre || '';

      const item = {
        tracking: e.id_venta || e.meli_id || e.tracking || '',
        cliente,
        destinatario: e.destinatario || '',
        direccion: e.direccion || '',
        piso_dpto: e.piso_dpto || '',
        partido: e.partido || '',
        cp: e.codigo_postal || '',
        telefono: e.telefono || '',
        estado: e.estado || '',
        fecha: e.fecha ? new Date(e.fecha).toLocaleDateString('es-AR') : '',
        referencia: e.referencia || ''
      };

      if (incluirCoordenadas === 'true') {
        item.latitud = e.latitud || '';
        item.longitud = e.longitud || '';
      }

      if (incluirIntentos === 'true') {
        item.intentos_fallidos = e.intentosFallidos?.length || 0;
      }

      if (incluirHistorial === 'true') {
        const ultimosCambios = (e.historial || [])
          .slice(-3)
          .map(h => `${new Date(h.at).toLocaleDateString('es-AR')}: ${h.estado}`)
          .join(' | ');
        item.historial = ultimosCambios;
      }

      return item;
    });

    // Según formato solicitado
    if (formato === 'preview') {
      return res.json({ items, total: items.length });
    }

    if (formato === 'xls') {
      // Generar Excel
      const ws = XLSX.utils.json_to_sheet(items);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

      // Autofiltros
      ws['!autofilter'] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])) };

      // Ancho de columnas
      ws['!cols'] = [
        { wch: 16 }, // tracking
        { wch: 20 }, // cliente
        { wch: 20 }, // destinatario
        { wch: 30 }, // direccion
        { wch: 12 }, // piso_dpto
        { wch: 18 }, // partido
        { wch: 8 },  // cp
        { wch: 14 }, // telefono
        { wch: 16 }, // estado
        { wch: 12 }, // fecha
        { wch: 20 }  // referencia
      ];

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=reporte_${Date.now()}.xlsx`);
      return res.send(buffer);
    }

    if (formato === 'pdf') {
      // TODO: Implementar generación de PDF
      return res.status(501).json({ error: 'PDF en desarrollo' });
    }

    return res.status(400).json({ error: 'Formato no válido' });

  } catch (err) {
    logger.error('[reportes/generar] error', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'No se pudo generar el reporte' });
  }
});

module.exports = router;
