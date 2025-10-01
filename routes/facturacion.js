// /routes/facturacion.js
const express = require('express');
const router  = express.Router();

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Lista   = require('../models/listaDePrecios');

const { resolverZonaPorCP } = require('../services/zonaResolver');

/**
 * GET /facturacion/preview?clienteId=...&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 * Devuelve { count, total, items[] } donde cada ítem ya trae Partido, Zona y Precio.
 */
router.get('/preview', async (req, res) => {
  try {
    const { clienteId, desde, hasta } = req.query;
    if (!clienteId || !desde || !hasta)
      return res.status(400).json({ error: 'Parámetros requeridos: clienteId, desde, hasta' });

    const dtFrom = new Date(desde);
    const dtTo   = new Date(hasta);
    if (isNaN(dtFrom) || isNaN(dtTo))
      return res.status(400).json({ error: 'Fechas inválidas' });

    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const lista = await Lista.findById(cliente.lista_precios).lean();
    if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });

    // Envíos del periodo para ese cliente (por cliente_id o por sender_id)
    const or = [{ cliente_id: cliente._id }];
    if (Array.isArray(cliente.sender_id) && cliente.sender_id.length) {
      for (const s of cliente.sender_id) or.push({ sender_id: s });
    }

    const envios = await Envio.find({
      fecha: { $gte: dtFrom, $lte: dtTo },
      $or: or
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio')
    .sort({ fecha: 1 })
    .populate('cliente_id', 'nombre codigo_cliente')
    .lean();

    const items = [];
    let total = 0;

    for (const e of envios) {
      // Resolver partido+zona
      const rz = await resolverZonaPorCP(e.codigo_postal, e.partido);
      const zonaId      = rz.zonaId;
      const zonaNombre  = rz.zonaNombre;
      const partido     = rz.partido || e.partido || null;

      // Buscar precio en la lista (matchea por zona ObjectId)
      let precio = 0;
      if (zonaId) {
        const z = (lista.zonas || []).find(z => String(z.zona) === String(zonaId));
        if (z) precio = Number(z.precio) || 0;
      }

      // Si ya tenías un precio guardado en el Envio (e.precio) y preferís priorizarlo:
      // if (typeof e.precio === 'number' && e.precio > 0) precio = e.precio;

      items.push({
        tracking: e.id_venta || e.meli_id || '',
        cliente:  e.cliente_id?.nombre || '',
        codigo_interno: e.cliente_id?.codigo_cliente || '',
        sender_id: e.sender_id || '',
        partido,
        zona: zonaNombre,
        precio,
        fecha: e.fecha,
        estado: e.estado
      });

      total += precio;
    }

    res.json({ count: items.length, total, items });
  } catch (err) {
    console.error('[facturacion/preview] error:', err);
    res.status(500).json({ error: 'Error generando preview' });
  }
});

module.exports = router;
