// /routes/facturacion.js
const express = require('express');
const router  = express.Router();

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Lista   = require('../models/listaDePrecios');

const { resolverZonaPorCP, resolverZonaParaCliente } = require('../services/zonaResolver');
const {
  buildQueryFacturacion,
  filtrarEnviosFacturables,
  calcularRangoFacturacion,
  getFechaIngresoEnvio
} = require('../utils/facturacion');
const PDFDocument = require('pdfkit'); // npm i pdfkit
const { Readable } = require('stream');
// Normalizadores mínimos
const normCP = s => String(s||'').replace(/\D/g,'').trim();
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

    // Cargar cliente completo con config de facturación
    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const lista = await Lista.findById(cliente.lista_precios).lean();
    if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });

    // Generar query amplia con nuevas utilidades de facturación
    const query = buildQueryFacturacion(clienteId, dtFrom, dtTo, cliente);

    // Traer envíos candidatos
    const enviosCandidatos = await Envio.find(query)
      .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio origen historial requiere_sync_meli createdAt updatedAt')
      .sort({ fecha: 1 })
      .populate('cliente_id', 'nombre codigo_cliente')
      .lean();

    // Filtrar por fecha de ingreso real + horarios de corte
    const envios = filtrarEnviosFacturables(enviosCandidatos, dtFrom, dtTo, cliente);

    // Log para debugging
    const rango = calcularRangoFacturacion(dtFrom, dtTo, cliente);
    console.log('📊 Facturación/Preview generada:', {
      cliente: cliente.nombre,
      rango_solicitado: { desde, hasta },
      rango_ajustado: rango.info,
      candidatos: enviosCandidatos.length,
      facturables: envios.length
    });

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
// ---------------------------------------------
// GET /facturacion/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&clientes=all|id1,id2,...
// Devuelve líneas agrupadas por (cliente, zona) para respetar precios por lista.
// ---------------------------------------------
router.get('/resumen', async (req, res) => {
  try {
    const { desde, hasta, clientes, estados } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros requeridos: desde, hasta' });

    const dtFrom = new Date(desde);
    const dtTo   = new Date(hasta);
    if (isNaN(dtFrom) || isNaN(dtTo)) return res.status(400).json({ error: 'Fechas inválidas' });

    // 1) Determinar universo de clientes - INCLUIR configuración de facturación
    let clientesDocs = [];
    if (clientes === 'all' || !clientes) {
      clientesDocs = await Cliente.find({}).lean();
    } else {
      const ids = String(clientes).split(',').map(s => s.trim()).filter(Boolean);
      clientesDocs = await Cliente.find({ _id: { $in: ids } }).lean();
    }
    const clientesMap = new Map(clientesDocs.map(c => [String(c._id), c]));

    // 2) Traer envíos del período para esos clientes
    // Ampliamos el rango para incluir todos los candidatos posibles
    const estadosFacturables = [
      'asignado',
      'en_camino',
      'en_planta',
      'entregado',
      'comprador_ausente',
      'inaccesible',
      'rechazado'
    ];

    const ors = [];
    for (const c of clientesDocs) {
      ors.push({ cliente_id: c._id });
      for (const s of (c.sender_id || [])) ors.push({ sender_id: s });
    }
    if (!ors.length) return res.json({ period: { desde, hasta }, lines: [], totalGeneral: 0, totalesPorCliente: [] });

    // Query amplia que incluye campos necesarios para determinar fecha de ingreso
    const enviosCandidatos = await Envio.find({
      $and: [
        { $or: ors },
        { estado: { $in: estadosFacturables } },
        {
          $or: [
            { fecha: { $gte: dtFrom, $lte: dtTo } },
            { createdAt: { $gte: dtFrom, $lte: dtTo } },
            { 'historial.at': { $gte: dtFrom, $lte: dtTo } }
          ]
        }
      ]
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado historial origen requiere_sync_meli createdAt updatedAt')
    .sort({ fecha: 1 })
    .lean();

    // Filtrar envíos por fecha de ingreso y horarios de corte según cada cliente
    const envios = [];
    for (const envio of enviosCandidatos) {
      const clienteId = String(envio.cliente_id || '');
      const cliente = clientesMap.get(clienteId);
      if (!cliente) continue;

      // Verificar si el envío pasa el filtro de facturación para este cliente
      const fechaIngreso = getFechaIngresoEnvio(envio);
      if (!fechaIngreso) continue;

      const rango = calcularRangoFacturacion(dtFrom, dtTo, cliente);
      const fechaDate = new Date(fechaIngreso);

      if (fechaDate >= rango.desde && fechaDate <= rango.hasta) {
        envios.push(envio);
      }
    }

    // Log para debugging
    console.log('📊 Facturación/Resumen generada:', {
      clientes_procesados: clientesDocs.length,
      rango_solicitado: { desde, hasta },
      candidatos: enviosCandidatos.length,
      facturables: envios.length
    });

    // 3) Pre-cargar listas de precios por cliente
    const listasIds = Array.from(new Set(clientesDocs.map(c => String(c.lista_precios)).filter(Boolean)));
    const listasDocs = await Lista.find({ _id: { $in: listasIds } }).populate('zonas.zona', 'nombre').lean();
    const listaMap = new Map(listasDocs.map(l => [String(l._id), l]));

    // 4) Resumir por (cliente, zona)
    //    clave = `${clienteId}__${zonaNombre}`
    const linesMap = new Map();
    let totalGeneral = 0;

    for (const e of envios) {
      const clienteId = String(e.cliente_id || '');
      const cliente   = clientesMap.get(clienteId);
      if (!cliente) continue; // por seguridad

      // Resolver zona SOLO entre las zonas de la lista del cliente
      const lista = listaMap.get(String(cliente.lista_precios));
      if (!lista) continue;

      const zonasDelCliente = lista.zonas || [];
      const rz = await resolverZonaParaCliente(e.codigo_postal, e.partido, zonasDelCliente);
      const zonaNombre = rz.zonaNombre || null;
      if (!zonaNombre) continue;

      // Precio por _id preferentemente, si no por nombre
      let precioUnit = 0;
      const zMatch = (lista.zonas || []).find(z => {
        if (z.zona?.nombre) return z.zona.nombre.trim().toLowerCase() === zonaNombre.trim().toLowerCase();
        return false;
      });
      if (zMatch) precioUnit = Number(zMatch.precio) || 0;

      // Si no hubo match exacto por nombre poblado, probamos por ObjectId del resolver (si vino)
      if (!precioUnit && rz.zonaId) {
        const z2 = (lista.zonas || []).find(z => String(z.zona) === String(rz.zonaId));
        if (z2) precioUnit = Number(z2.precio) || 0;
      }

      const key = `${clienteId}__${zonaNombre.toLowerCase()}`;
      const prev = linesMap.get(key) || {
        cliente_id: clienteId,
        cliente_nombre: cliente.nombre,
        codigo_interno: cliente.codigo_cliente || '',
        zona_nombre: zonaNombre,
        precio_unit: precioUnit,
        cantidad: 0,
        subtotal: 0
      };

      prev.cantidad += 1;
      // si existen diferentes precios por misma zona en la lista (raro), tomamos el encontrado 1ro
      prev.subtotal = prev.cantidad * prev.precio_unit;
      linesMap.set(key, prev);
    }

    const lines = Array.from(linesMap.values()).sort((a,b) =>
      a.cliente_nombre.localeCompare(b.cliente_nombre) || a.zona_nombre.localeCompare(b.zona_nombre)
    );

    const totalesPorClienteMap = new Map();
    for (const l of lines) {
      totalGeneral += l.subtotal;
      const acc = totalesPorClienteMap.get(l.cliente_id) || { cliente_id: l.cliente_id, cliente_nombre: l.cliente_nombre, total: 0 };
      acc.total += l.subtotal;
      totalesPorClienteMap.set(l.cliente_id, acc);
    }

    const totalesPorCliente = Array.from(totalesPorClienteMap.values());

    res.json({
      period: { desde, hasta },
      lines,
      totalGeneral,
      totalesPorCliente
    });
  } catch (err) {
    console.error('[facturacion/resumen] error:', err);
    res.status(500).json({ error: 'Error generando resumen' });
  }
});

// ---------------------------------------------
// POST /facturacion/presupuesto  -> genera PDF con el resumen (líneas)
// body: { periodo:{desde,hasta}, lines:[{cliente_nombre,zona_nombre,precio_unit,cantidad,subtotal}], totalGeneral }
// ---------------------------------------------
router.post('/presupuesto', async (req, res) => {
  try {
    const { periodo, lines = [], totalGeneral = 0, cliente = null } = req.body || {};

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="presupuesto.pdf"');

    Readable.from(doc);

    // Encabezado simple
    doc.fontSize(16).text('Presupuesto de Servicios de Distribución', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Período: ${periodo?.desde || '-'} a ${periodo?.hasta || '-'}`);
    if (cliente?.nombre) doc.text(`Cliente: ${cliente.nombre}`);
    doc.moveDown();

    // Cabecera de tabla
    const headers = ['Cliente', 'Zona', 'Cant.', 'Precio Unit.', 'Subtotal'];
    const widths  = [160, 160, 50, 90, 90]; // ajustado para que entre cómodo

    doc.fontSize(10).fillColor('#000');
    headers.forEach((h, i) => doc.text(h, 36 + widths.slice(0,i).reduce((a,b)=>a+b,0), doc.y, { width: widths[i], continued: i < headers.length-1 }));
    doc.moveDown(0.2);
    doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke();

    // Filas
    lines.forEach(row => {
      const vals = [
        row.cliente_nombre || '',
        row.zona_nombre || '',
        String(row.cantidad || 0),
        new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(row.precio_unit || 0),
        new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(row.subtotal || 0),
      ];
      vals.forEach((v, i) => doc.text(v, 36 + widths.slice(0,i).reduce((a,b)=>a+b,0), doc.y, { width: widths[i], continued: i < vals.length-1 }));
      doc.moveDown(0.2);
    });

    doc.moveDown();
    doc.moveTo(36, doc.y).lineTo(559, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).text(`TOTAL: ${new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(totalGeneral || 0)}`, { align: 'right' });

    doc.end();
    doc.pipe(res);
  } catch (err) {
    console.error('[facturacion/presupuesto] error:', err);
    res.status(500).json({ error: 'No se pudo generar el PDF' });
  }
});

// ---------------------------------------------
// POST /facturacion/emitir  -> hook futuro para AFIP/ARCA
// body: { periodo, lines, clienteIds? }  (no emite aún; sólo devuelve OK)
// ---------------------------------------------
router.post('/emitir', async (req, res) => {
  // TODO: en la próxima etapa llamamos WSAA/WSFEv1
  res.json({ ok: true, message: 'Hook de emisión listo. Próximo paso: AFIP/ARCA.' });
});

// GET /facturacion/detalle?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&clientes=all|id1,id2,...
// Devuelve items por envío (tracking, cliente, zona, precio, etc.)
router.get('/detalle', async (req, res) => {
  try {
    const { desde, hasta, clientes, estados } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros requeridos: desde, hasta' });

    const dtFrom = new Date(desde);
    const dtTo   = new Date(hasta);
    if (isNaN(dtFrom) || isNaN(dtTo)) return res.status(400).json({ error: 'Fechas inválidas' });

    // clientes a incluir - INCLUIR configuración de facturación
    let clientesDocs = [];
    if (clientes === 'all' || !clientes) {
      clientesDocs = await Cliente.find({}).lean();
    } else {
      const ids = String(clientes).split(',').map(s => s.trim()).filter(Boolean);
      clientesDocs = await Cliente.find({ _id: { $in: ids } }).lean();
    }
    const cMap = new Map(clientesDocs.map(c => [String(c._id), c]));

    // Preparar query amplia
    const estadosFacturables = [
      'asignado',
      'en_camino',
      'en_planta',
      'entregado',
      'comprador_ausente',
      'inaccesible',
      'rechazado'
    ];

    const ors = [];
    for (const c of clientesDocs) {
      ors.push({ cliente_id: c._id });
      for (const s of (c.sender_id || [])) ors.push({ sender_id: s });
    }
    if (!ors.length) return res.json({ items: [], total: 0 });

    // Query amplia que incluye campos necesarios para determinar fecha de ingreso
    const enviosCandidatos = await Envio.find({
      $and: [
        { $or: ors },
        { estado: { $in: estadosFacturables } },
        {
          $or: [
            { fecha: { $gte: dtFrom, $lte: dtTo } },
            { createdAt: { $gte: dtFrom, $lte: dtTo } },
            { 'historial.at': { $gte: dtFrom, $lte: dtTo } }
          ]
        }
      ]
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio historial origen requiere_sync_meli createdAt updatedAt')
    .sort({ fecha: 1 })
    .populate('cliente_id', 'nombre codigo_cliente lista_precios')
    .lean();

    // Filtrar envíos por fecha de ingreso y horarios de corte según cada cliente
    const envios = [];
    for (const envio of enviosCandidatos) {
      const clienteId = String(envio.cliente_id?._id || envio.cliente_id || '');
      const cliente = cMap.get(clienteId);
      if (!cliente) continue;

      // Verificar si el envío pasa el filtro de facturación para este cliente
      const fechaIngreso = getFechaIngresoEnvio(envio);
      if (!fechaIngreso) continue;

      const rango = calcularRangoFacturacion(dtFrom, dtTo, cliente);
      const fechaDate = new Date(fechaIngreso);

      if (fechaDate >= rango.desde && fechaDate <= rango.hasta) {
        envios.push(envio);
      }
    }

    // Log para debugging
    console.log('📊 Facturación/Detalle generada:', {
      clientes_procesados: clientesDocs.length,
      rango_solicitado: { desde, hasta },
      candidatos: enviosCandidatos.length,
      facturables: envios.length
    });

    // Pre-cargo listas de precios (pobladas con nombres de zona)
    const listaIds = Array.from(new Set(envios
      .map(e => e.cliente_id?.lista_precios)
      .filter(Boolean)
      .map(x => String(x))
    ));
    const listas = await Lista.find({ _id: { $in: listaIds } })
      .populate('zonas.zona','nombre')
      .lean();
    const lMap = new Map(listas.map(l => [String(l._id), l]));

    const items = [];
    let total = 0;

    for (const e of envios) {
      const cliente = e.cliente_id;
      if (!cliente) continue;

      // Resolver zona SOLO entre las zonas de la lista del cliente
      const lista = lMap.get(String(cliente.lista_precios));
      const zonasDelCliente = lista?.zonas || [];
      const rz = await resolverZonaParaCliente(e.codigo_postal, e.partido, zonasDelCliente);
      const zonaNombre = rz.zonaNombre || null;

      // Precio: usar el precio de la zona encontrada
      let precio = 0;
      if (lista && zonaNombre) {
        const z1 = (lista.zonas || []).find(z => z.zona?.nombre?.trim().toLowerCase() === zonaNombre.trim().toLowerCase());
        if (z1) precio = Number(z1.precio) || 0;
        else if (rz.zonaId) {
          const z2 = (lista.zonas || []).find(z => String(z.zona) === String(rz.zonaId));
          if (z2) precio = Number(z2.precio) || 0;
        }
      }

      items.push({
        tracking: e.id_venta || e.meli_id || '',
        cliente:  cliente?.nombre || '',
        codigo_interno: cliente?.codigo_cliente || '',
        sender_id: e.sender_id || '',
        partido: rz.partido || e.partido || '',
        zona: zonaNombre,
        precio,
        fecha: e.fecha,
        estado: e.estado
      });
      total += precio;
    }

    res.json({ items, total });
  } catch (err) {
    console.error('[facturacion/detalle] error:', err);
    res.status(500).json({ error: 'Error generando detalle' });
  }
});


module.exports = router;
