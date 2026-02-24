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
  getFechaIngresoEnvio,
  calcularSemanaAnterior
} = require('../utils/facturacion');
const PDFDocument = require('pdfkit'); // npm i pdfkit
const Tenant = require('../models/Tenant');
const { requireAuth } = require('../middlewares/auth');
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

    const dtFrom = new Date(desde + 'T00:00:00-03:00');
    const dtTo   = new Date(hasta + 'T23:59:59.999-03:00');
    if (isNaN(dtFrom) || isNaN(dtTo))
      return res.status(400).json({ error: 'Fechas inválidas' });

    // Cargar cliente completo con config de facturación
    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const lista = await Lista.findById(cliente.lista_precios).lean();
    if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });

    // Generar query amplia con nuevas utilidades de facturación
    const query = buildQueryFacturacion(clienteId, dtFrom, dtTo);

    // Traer envíos candidatos
    const enviosCandidatos = await Envio.find(query)
      .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio origen historial requiere_sync_meli createdAt updatedAt')
      .sort({ fecha: 1 })
      .populate('cliente_id', 'nombre codigo_cliente')
      .lean();

    // Filtrar por scan QR en planta
    const envios = filtrarEnviosFacturables(enviosCandidatos, dtFrom, dtTo);

    // Log para debugging
    const rango = calcularRangoFacturacion(dtFrom, dtTo);
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
    const { desde, hasta, clientes } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros requeridos: desde, hasta' });

    const dtFrom = new Date(desde + 'T00:00:00-03:00');
    const dtTo   = new Date(hasta + 'T23:59:59.999-03:00');
    if (isNaN(dtFrom) || isNaN(dtTo)) return res.status(400).json({ error: 'Fechas inválidas' });

    // 1) Determinar universo de clientes
    let clientesDocs = [];
    if (clientes === 'all' || !clientes) {
      clientesDocs = await Cliente.find({}).lean();
    } else {
      const ids = String(clientes).split(',').map(s => s.trim()).filter(Boolean);
      clientesDocs = await Cliente.find({ _id: { $in: ids } }).lean();
    }
    const clientesMap = new Map(clientesDocs.map(c => [String(c._id), c]));

    // 2) Traer envíos del período para esos clientes — solo los que pasaron por planta
    const ors = [];
    for (const c of clientesDocs) {
      ors.push({ cliente_id: c._id });
      for (const s of (c.sender_id || [])) ors.push({ sender_id: s });
    }
    if (!ors.length) return res.json({ period: { desde, hasta }, lines: [], totalGeneral: 0, totalesPorCliente: [] });

    const enviosCandidatos = await Envio.find({
      $and: [
        { $or: ors },
        { $or: [
          { 'historial.source': 'zupply:qr' },
          { 'historial.source': 'scanner' }
        ]},
        { 'historial.at': { $gte: dtFrom, $lte: dtTo } }
      ]
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio historial origen createdAt updatedAt')
    .sort({ fecha: 1 })
    .lean();

    const envios = filtrarEnviosFacturables(enviosCandidatos, dtFrom, dtTo);

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
// POST /facturacion/presupuesto  -> genera PDF profesional con datos fiscales
// body: { periodo:{desde,hasta}, lines:[{cliente_id,cliente_nombre,codigo_interno,zona_nombre,precio_unit,cantidad,subtotal}], totalGeneral, clienteId? }
// ---------------------------------------------
router.post('/presupuesto', requireAuth, async (req, res) => {
  try {
    const { periodo, lines = [], totalGeneral = 0, clienteId } = req.body || {};

    // 1. Cargar datos del tenant (emisor)
    const tenantId = req.session?.user?.tenantId || req.tenantId;
    const tenant = await Tenant.findById(tenantId)
      .select('companyName settings fiscal')
      .lean();

    // 2. Si es presupuesto para un solo cliente, cargar sus datos
    let clienteData = null;
    if (clienteId) {
      clienteData = await Cliente.findById(clienteId)
        .select('nombre razon_social cuit condicion_iva codigo_cliente')
        .lean();
    } else if (lines.length > 0) {
      const clienteIds = [...new Set(lines.map(l => l.cliente_id).filter(Boolean))];
      if (clienteIds.length === 1) {
        clienteData = await Cliente.findById(clienteIds[0])
          .select('nombre razon_social cuit condicion_iva codigo_cliente')
          .lean();
      }
    }

    // 3. Si el tenant tiene logo en S3, descargarlo para el PDF
    let logoBuffer = null;
    if (tenant?.settings?.logo) {
      try {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const s3 = new S3Client({
          region: process.env.S3_REGION,
          endpoint: process.env.S3_ENDPOINT,
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
          }
        });
        const result = await s3.send(new GetObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: tenant.settings.logo
        }));
        const chunks = [];
        for await (const chunk of result.Body) chunks.push(chunk);
        logoBuffer = Buffer.concat(chunks);
      } catch (e) {
        console.warn('No se pudo cargar logo de S3:', e.message);
      }
    }

    // 4. Generar número de presupuesto
    const nroPresupuesto = String(Date.now()).slice(-8).padStart(8, '0');

    // 5. Generar PDF con PDFKit
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presupuesto-${nroPresupuesto}.pdf"`);
    doc.pipe(res);

    const pageWidth = doc.page.width - 80; // margin * 2
    const marginLeft = 40;
    const marginRight = doc.page.width - 40;

    // Formato moneda argentina
    const fmtARS = (n) => {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n || 0).replace('ARS', '$').trim();
    };

    // ====== HEADER ======

    // Fondo suave del header
    doc.save();
    doc.rect(marginLeft, 40, pageWidth, 90).fill('#FFF7ED');
    doc.restore();

    // Logo (si existe)
    let headerTextX = marginLeft + 15;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, marginLeft + 10, 48, { height: 45 });
        headerTextX = marginLeft + 150;
      } catch (e) {
        console.warn('Error insertando logo en PDF:', e.message);
      }
    }

    // Datos del emisor (izquierda)
    doc.fontSize(9).fillColor('#374151');
    const fiscal = tenant?.fiscal || {};
    const emisorNombre = fiscal.razon_social || tenant?.companyName || 'Empresa';
    doc.font('Helvetica-Bold').fontSize(11).text(emisorNombre, headerTextX, 50);
    doc.font('Helvetica').fontSize(8);
    if (fiscal.cuit) doc.text(`CUIT: ${fiscal.cuit}`, headerTextX, doc.y + 2);
    if (fiscal.domicilio_fiscal) doc.text(fiscal.domicilio_fiscal, headerTextX, doc.y + 1);
    if (fiscal.condicion_iva) {
      const condLabels = {
        responsable_inscripto: 'Responsable Inscripto',
        monotributista: 'Monotributista',
        exento: 'Exento',
        consumidor_final: 'Consumidor Final'
      };
      doc.text(`Condición IVA: ${condLabels[fiscal.condicion_iva] || fiscal.condicion_iva}`, headerTextX, doc.y + 1);
    }

    // Título PRESUPUESTO (derecha)
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#92400E');
    doc.text('PRESUPUESTO', marginRight - 200, 50, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`Nº ${nroPresupuesto}`, marginRight - 200, doc.y + 2, { width: 200, align: 'right' });
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, marginRight - 200, doc.y + 2, { width: 200, align: 'right' });

    // ====== PERÍODO ======
    let currentY = 145;
    doc.moveTo(marginLeft, currentY).lineTo(marginRight, currentY).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    currentY += 8;
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`Período: ${periodo?.desde || '-'} al ${periodo?.hasta || '-'}`, marginLeft + 10, currentY);
    currentY += 20;
    doc.moveTo(marginLeft, currentY).lineTo(marginRight, currentY).lineWidth(0.5).strokeColor('#D1D5DB').stroke();

    // ====== DATOS DEL CLIENTE ======
    currentY += 8;
    if (clienteData) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937');
      doc.text('CLIENTE', marginLeft + 10, currentY);
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
      currentY += 14;
      doc.text(`Nombre: ${clienteData.nombre || '-'}`, marginLeft + 10, currentY);
      if (clienteData.codigo_cliente) doc.text(`Código: ${clienteData.codigo_cliente}`, marginLeft + 10, doc.y + 2);
      if (clienteData.razon_social) doc.text(`Razón Social: ${clienteData.razon_social}`, marginLeft + 10, doc.y + 2);

      // Datos fiscales del cliente (derecha)
      const clienteFiscalX = marginLeft + 300;
      doc.text(`CUIT: ${clienteData.cuit || '-'}`, clienteFiscalX, currentY);
      doc.text(`Cond. IVA: ${clienteData.condicion_iva || '-'}`, clienteFiscalX, doc.y + 2);
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#6B7280');
      doc.text('Presupuesto general — múltiples clientes', marginLeft + 10, currentY);
    }

    currentY = doc.y + 15;
    doc.moveTo(marginLeft, currentY).lineTo(marginRight, currentY).lineWidth(0.5).strokeColor('#D1D5DB').stroke();

    // ====== TABLA DE LÍNEAS ======
    currentY += 10;

    // Header de tabla
    const colWidths = {
      desc: 200,
      cant: 60,
      precioUnit: 110,
      subtotal: 110
    };

    // Fondo del header de tabla
    doc.save();
    doc.rect(marginLeft, currentY - 3, pageWidth, 18).fill('#F3F4F6');
    doc.restore();

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151');
    let colX = marginLeft + 10;
    doc.text('Descripción', colX, currentY);
    colX += colWidths.desc;
    doc.text('Cant.', colX, currentY, { width: colWidths.cant, align: 'right' });
    colX += colWidths.cant;
    doc.text('Precio Unit.', colX, currentY, { width: colWidths.precioUnit, align: 'right' });
    colX += colWidths.precioUnit;
    doc.text('Subtotal', colX, currentY, { width: colWidths.subtotal, align: 'right' });

    currentY += 20;
    doc.moveTo(marginLeft, currentY).lineTo(marginRight, currentY).lineWidth(0.3).strokeColor('#E5E7EB').stroke();

    // Filas
    doc.font('Helvetica').fontSize(8.5).fillColor('#1F2937');

    // Ordenar líneas por cliente y zona
    const sortedLines = [...lines].sort((a, b) => {
      const cmp = (a.cliente_nombre || '').localeCompare(b.cliente_nombre || '');
      if (cmp !== 0) return cmp;
      return (a.zona_nombre || '').localeCompare(b.zona_nombre || '');
    });

    sortedLines.forEach((line, idx) => {
      currentY += 4;

      // Fondo alternado
      if (idx % 2 === 0) {
        doc.save();
        doc.rect(marginLeft, currentY - 2, pageWidth, 16).fill('#FAFAFA');
        doc.restore();
        doc.fillColor('#1F2937');
      }

      // Descripción: incluir nombre del cliente si es multi-cliente
      let desc = line.zona_nombre || '-';
      if (!clienteData && line.cliente_nombre) {
        desc = `${line.cliente_nombre} — ${desc}`;
      }

      colX = marginLeft + 10;
      doc.text(desc, colX, currentY, { width: colWidths.desc - 10 });
      colX += colWidths.desc;
      doc.text(String(line.cantidad || 0), colX, currentY, { width: colWidths.cant, align: 'right' });
      colX += colWidths.cant;
      doc.text(fmtARS(line.precio_unit), colX, currentY, { width: colWidths.precioUnit, align: 'right' });
      colX += colWidths.precioUnit;
      doc.text(fmtARS(line.subtotal), colX, currentY, { width: colWidths.subtotal, align: 'right' });

      currentY += 14;

      // Si se va de página, crear nueva
      if (currentY > doc.page.height - 120) {
        doc.addPage();
        currentY = 40;
      }
    });

    // ====== TOTALES ======
    currentY += 10;
    doc.moveTo(marginLeft + pageWidth * 0.5, currentY).lineTo(marginRight, currentY).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    currentY += 8;

    const totalX = marginRight - 230;
    const totalValX = marginRight - 120;

    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text('Importe Neto No Gravado:', totalX, currentY, { width: 120, align: 'right' });
    doc.text(fmtARS(totalGeneral), totalValX, currentY, { width: 120, align: 'right' });

    currentY += 16;
    doc.moveTo(marginLeft + pageWidth * 0.5, currentY).lineTo(marginRight, currentY).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    currentY += 8;

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#92400E');
    doc.text('TOTAL:', totalX, currentY, { width: 120, align: 'right' });
    doc.text(fmtARS(totalGeneral), totalValX, currentY, { width: 120, align: 'right' });

    // ====== FOOTER ======
    const footerY = doc.page.height - 50;
    doc.moveTo(marginLeft, footerY - 10).lineTo(marginRight, footerY - 10).lineWidth(0.3).strokeColor('#E5E7EB').stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF');
    doc.text('Documento no válido como factura. Presupuesto generado por Zupply.', marginLeft, footerY, { align: 'center', width: pageWidth });
    doc.text(`Pág 1/1`, marginRight - 50, footerY);

    doc.end();
  } catch (err) {
    console.error('[facturacion/presupuesto] error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo generar el PDF' });
    }
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
    const { desde, hasta, clientes } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Parámetros requeridos: desde, hasta' });

    const dtFrom = new Date(desde + 'T00:00:00-03:00');
    const dtTo   = new Date(hasta + 'T23:59:59.999-03:00');
    if (isNaN(dtFrom) || isNaN(dtTo)) return res.status(400).json({ error: 'Fechas inválidas' });

    // clientes a incluir
    let clientesDocs = [];
    if (clientes === 'all' || !clientes) {
      clientesDocs = await Cliente.find({}).lean();
    } else {
      const ids = String(clientes).split(',').map(s => s.trim()).filter(Boolean);
      clientesDocs = await Cliente.find({ _id: { $in: ids } }).lean();
    }
    const cMap = new Map(clientesDocs.map(c => [String(c._id), c]));

    // Preparar query — solo envíos que pasaron por planta en el rango
    const ors = [];
    for (const c of clientesDocs) {
      ors.push({ cliente_id: c._id });
      for (const s of (c.sender_id || [])) ors.push({ sender_id: s });
    }
    if (!ors.length) return res.json({ items: [], total: 0 });

    const enviosCandidatos = await Envio.find({
      $and: [
        { $or: ors },
        { $or: [
          { 'historial.source': 'zupply:qr' },
          { 'historial.source': 'scanner' }
        ]},
        { 'historial.at': { $gte: dtFrom, $lte: dtTo } }
      ]
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio historial origen createdAt updatedAt')
    .sort({ fecha: 1 })
    .populate('cliente_id', 'nombre codigo_cliente lista_precios')
    .lean();

    const envios = filtrarEnviosFacturables(enviosCandidatos, dtFrom, dtTo);

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

      const fechaIngreso = getFechaIngresoEnvio(e);

      items.push({
        tracking: e.id_venta || e.meli_id || '',
        cliente:  cliente?.nombre || '',
        codigo_interno: cliente?.codigo_cliente || '',
        sender_id: e.sender_id || '',
        partido: rz.partido || e.partido || '',
        zona: zonaNombre,
        precio,
        fecha: e.fecha,
        fecha_ingreso: fechaIngreso,
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
