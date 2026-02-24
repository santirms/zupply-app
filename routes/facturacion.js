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
    const { periodo, lines = [], totalGeneral = 0, clienteId, envios: enviosDetalle = [] } = req.body || {};

    // 1. Cargar tenant (emisor)
    const tenantId = req.session?.user?.tenantId || req.tenantId;
    const tenant = await Tenant.findById(tenantId).select('companyName settings fiscal').lean();

    // 2. Cargar cliente (receptor) si aplica
    let clienteData = null;
    if (clienteId) {
      clienteData = await Cliente.findById(clienteId)
        .select('nombre razon_social cuit condicion_iva codigo_cliente')
        .lean();
    } else if (lines.length > 0) {
      const cids = [...new Set(lines.map(l => l.cliente_id).filter(Boolean))];
      if (cids.length === 1) {
        clienteData = await Cliente.findById(cids[0])
          .select('nombre razon_social cuit condicion_iva codigo_cliente')
          .lean();
      }
    }

    // 3. Descargar logo de S3 si existe
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
        console.warn('No se pudo cargar logo:', e.message);
      }
    }

    // 4. Número de presupuesto
    const nroPresupuesto = String(Date.now()).slice(-8).padStart(8, '0');

    // 5. Generar PDF
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="presupuesto-${nroPresupuesto}.pdf"`);
    doc.pipe(res);

    const marginLeft = 40;
    const marginRight = doc.page.width - 40;
    const pageWidth = marginRight - marginLeft;

    const fmtARS = (n) => {
      return new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS',
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(n || 0).replace('ARS', '$').trim();
    };

    const fmtFecha = (f) => {
      if (!f) return '-';
      const d = new Date(f);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const fmtFechaCorta = (f) => {
      if (!f) return '-';
      const d = new Date(f);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // ══════════════════════════════════════════════
    // PÁGINA 1: PRESUPUESTO RESUMEN
    // ══════════════════════════════════════════════

    // --- HEADER con fondo ---
    doc.save();
    doc.rect(marginLeft, 40, pageWidth, 90).fill('#FFF7ED');
    doc.restore();

    // Logo
    let headerTextX = marginLeft + 15;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, marginLeft + 10, 48, { height: 50, width: 120, fit: [120, 50] });
        headerTextX = marginLeft + 145;
      } catch (e) {
        console.warn('Error insertando logo:', e.message);
      }
    }

    // Datos emisor
    const fiscal = tenant?.fiscal || {};
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F2937');
    doc.text(fiscal.razon_social || tenant?.companyName || '', headerTextX, 50);
    doc.font('Helvetica').fontSize(8).fillColor('#374151');
    if (fiscal.cuit) doc.text(`CUIT: ${fiscal.cuit}`, headerTextX, doc.y + 2);
    if (fiscal.domicilio_fiscal) doc.text(fiscal.domicilio_fiscal, headerTextX, doc.y + 1);
    if (fiscal.condicion_iva) {
      const condLabels = {
        responsable_inscripto: 'Responsable Inscripto',
        monotributista: 'Monotributista',
        exento: 'Exento',
        consumidor_final: 'Consumidor Final'
      };
      doc.text(`${condLabels[fiscal.condicion_iva] || fiscal.condicion_iva}`, headerTextX, doc.y + 1);
    }

    // Título derecha
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#92400E');
    doc.text('PRESUPUESTO', marginRight - 200, 48, { width: 195, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`Nº ${nroPresupuesto}`, marginRight - 200, 68, { width: 195, align: 'right' });
    doc.text(`Fecha: ${fmtFecha(new Date())}`, marginRight - 200, 80, { width: 195, align: 'right' });

    // --- Período ---
    let y = 145;
    doc.moveTo(marginLeft, y).lineTo(marginRight, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
    doc.text(`Período: ${fmtFecha(periodo?.desde)} al ${fmtFecha(periodo?.hasta)}`, marginLeft + 10, y);
    y += 20;
    doc.moveTo(marginLeft, y).lineTo(marginRight, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();

    // --- Cliente ---
    y += 8;
    if (clienteData) {
      // Columna izquierda
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1F2937');
      doc.text('CLIENTE', marginLeft + 10, y);
      y += 14;
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151');
      doc.text(`Nombre: ${clienteData.nombre || '-'}`, marginLeft + 10, y);
      if (clienteData.codigo_cliente) doc.text(`Código: ${clienteData.codigo_cliente}`, marginLeft + 10, doc.y + 2);
      if (clienteData.razon_social) doc.text(`Razón Social: ${clienteData.razon_social}`, marginLeft + 10, doc.y + 2);

      // Columna derecha
      const rxCol = marginLeft + 300;
      doc.text(`CUIT: ${clienteData.cuit || '-'}`, rxCol, y);
      doc.text(`Cond. IVA: ${clienteData.condicion_iva || '-'}`, rxCol, doc.y + 2);
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#6B7280');
      doc.text('Presupuesto general — múltiples clientes', marginLeft + 10, y);
    }

    y = Math.max(doc.y + 12, y + 40);
    doc.moveTo(marginLeft, y).lineTo(marginRight, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();

    // --- Tabla resumen ---
    y += 10;
    const col = { desc: 200, cant: 60, pu: 120, sub: 120 };

    // Header tabla
    doc.save().rect(marginLeft, y - 3, pageWidth, 18).fill('#F3F4F6').restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151');
    let cx = marginLeft + 10;
    doc.text('Descripción', cx, y); cx += col.desc;
    doc.text('Cant.', cx, y, { width: col.cant, align: 'right' }); cx += col.cant;
    doc.text('Precio Unit.', cx, y, { width: col.pu, align: 'right' }); cx += col.pu;
    doc.text('Subtotal', cx, y, { width: col.sub, align: 'right' });

    y += 20;
    doc.moveTo(marginLeft, y).lineTo(marginRight, y).lineWidth(0.3).strokeColor('#E5E7EB').stroke();

    // Filas resumen
    doc.font('Helvetica').fontSize(8.5).fillColor('#1F2937');
    const sorted = [...lines].sort((a, b) =>
      (a.cliente_nombre || '').localeCompare(b.cliente_nombre || '') ||
      (a.zona_nombre || '').localeCompare(b.zona_nombre || '')
    );

    sorted.forEach((line, idx) => {
      y += 4;
      if (idx % 2 === 0) {
        doc.save().rect(marginLeft, y - 2, pageWidth, 16).fill('#FAFAFA').restore();
        doc.fillColor('#1F2937');
      }

      let desc = line.zona_nombre || '-';
      if (!clienteData && line.cliente_nombre) desc = `${line.cliente_nombre} — ${desc}`;

      cx = marginLeft + 10;
      doc.text(desc, cx, y, { width: col.desc - 10 }); cx += col.desc;
      doc.text(String(line.cantidad || 0), cx, y, { width: col.cant, align: 'right' }); cx += col.cant;
      doc.text(fmtARS(line.precio_unit), cx, y, { width: col.pu, align: 'right' }); cx += col.pu;
      doc.text(fmtARS(line.subtotal), cx, y, { width: col.sub, align: 'right' });
      y += 14;
    });

    // Totales
    y += 10;
    doc.moveTo(marginLeft + pageWidth * 0.5, y).lineTo(marginRight, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    y += 8;
    const tLabelX = marginRight - 250;
    const tValX = marginRight - 120;
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text('Importe Neto No Gravado:', tLabelX, y, { width: 130, align: 'right' });
    doc.text(fmtARS(totalGeneral), tValX, y, { width: 120, align: 'right' });

    y += 18;
    doc.moveTo(marginLeft + pageWidth * 0.5, y).lineTo(marginRight, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#92400E');
    doc.text('TOTAL:', tLabelX, y, { width: 130, align: 'right' });
    doc.text(fmtARS(totalGeneral), tValX, y, { width: 120, align: 'right' });

    // ══════════════════════════════════════════════
    // PÁGINAS 2+: DETALLE POR FECHA
    // ══════════════════════════════════════════════

    if (enviosDetalle.length > 0) {
      doc.addPage();

      // Agrupar envíos por fecha de ingreso a planta
      const porFecha = {};
      enviosDetalle.forEach(e => {
        const fechaRaw = e.fecha_ingreso || e.fecha;
        const fechaKey = fechaRaw ? new Date(fechaRaw).toISOString().split('T')[0] : 'sin-fecha';
        if (!porFecha[fechaKey]) porFecha[fechaKey] = [];
        porFecha[fechaKey].push(e);
      });

      // Ordenar fechas cronológicamente
      const fechasOrdenadas = Object.keys(porFecha).sort();

      // Header del detalle
      y = 40;
      doc.save().rect(marginLeft, y, pageWidth, 35).fill('#FFF7ED').restore();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#92400E');
      doc.text('DETALLE DE ENVÍOS', marginLeft + 15, y + 5);
      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      doc.text(`Período: ${fmtFecha(periodo?.desde)} al ${fmtFecha(periodo?.hasta)}`, marginLeft + 15, y + 22);
      if (clienteData) {
        doc.text(`Cliente: ${clienteData.nombre || ''} (${clienteData.codigo_cliente || ''})`, marginLeft + 250, y + 22);
      }

      y = 90;

      // Columnas del detalle
      const dCol = { tracking: 180, zona: 180, precio: 120 };

      // Header de columnas
      doc.save().rect(marginLeft, y - 3, pageWidth, 16).fill('#F3F4F6').restore();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151');
      cx = marginLeft + 10;
      doc.text('Tracking / ID', cx, y); cx += dCol.tracking;
      doc.text('Zona', cx, y); cx += dCol.zona;
      doc.text('Precio', cx, y, { width: dCol.precio, align: 'right' });
      y += 16;

      let totalEnvios = 0;
      let totalPrecioDetalle = 0;

      fechasOrdenadas.forEach(fechaKey => {
        const enviosDelDia = porFecha[fechaKey];

        // Check si necesitamos nueva página
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = 40;
          // Re-dibujar header columnas
          doc.save().rect(marginLeft, y - 3, pageWidth, 16).fill('#F3F4F6').restore();
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151');
          cx = marginLeft + 10;
          doc.text('Tracking / ID', cx, y); cx += dCol.tracking;
          doc.text('Zona', cx, y); cx += dCol.zona;
          doc.text('Precio', cx, y, { width: dCol.precio, align: 'right' });
          y += 16;
        }

        // Separator de fecha
        y += 4;
        doc.save().rect(marginLeft, y - 2, pageWidth, 15).fill('#E5E7EB').restore();
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#1F2937');
        const fechaDisplay = fechaKey === 'sin-fecha' ? 'Sin fecha' : fmtFechaCorta(fechaKey + 'T12:00:00');
        doc.text(fechaDisplay, marginLeft + 10, y);
        y += 17;

        let subtotalDia = 0;

        enviosDelDia.forEach((env, idx) => {
          // Nueva página si no hay espacio
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = 40;
            doc.save().rect(marginLeft, y - 3, pageWidth, 16).fill('#F3F4F6').restore();
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151');
            cx = marginLeft + 10;
            doc.text('Tracking / ID', cx, y); cx += dCol.tracking;
            doc.text('Zona', cx, y); cx += dCol.zona;
            doc.text('Precio', cx, y, { width: dCol.precio, align: 'right' });
            y += 16;
          }

          // Fondo alternado
          if (idx % 2 === 0) {
            doc.save().rect(marginLeft, y - 1, pageWidth, 13).fill('#FAFAFA').restore();
          }

          const precio = typeof env.precio === 'number' ? env.precio : 0;
          subtotalDia += precio;
          totalPrecioDetalle += precio;
          totalEnvios++;

          doc.font('Helvetica').fontSize(7.5).fillColor('#374151');
          cx = marginLeft + 10;
          doc.text(env.tracking || '-', cx, y, { width: dCol.tracking - 10 }); cx += dCol.tracking;
          doc.text(env.zona || '-', cx, y, { width: dCol.zona - 10 }); cx += dCol.zona;
          doc.text(fmtARS(precio), cx, y, { width: dCol.precio, align: 'right' });
          y += 13;
        });

        // Subtotal del día
        y += 2;
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#6B7280');
        doc.text(
          `Subtotal: ${fmtARS(subtotalDia)}  (${enviosDelDia.length} envío${enviosDelDia.length !== 1 ? 's' : ''})`,
          marginLeft + 10, y, { width: pageWidth - 20, align: 'right' }
        );
        y += 15;
      });

      // Total general del detalle
      y += 5;
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 40;
      }
      doc.save().rect(marginLeft, y - 3, pageWidth, 22).fill('#FFF7ED').restore();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#92400E');
      doc.text(
        `TOTAL: ${fmtARS(totalPrecioDetalle)}  (${totalEnvios} envíos)`,
        marginLeft + 10, y, { width: pageWidth - 20, align: 'right' }
      );
    }

    // ══════════════════════════════════════════════
    // FOOTER en todas las páginas
    // ══════════════════════════════════════════════
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 40;
      doc.moveTo(marginLeft, footerY - 5).lineTo(marginRight, footerY - 5).lineWidth(0.3).strokeColor('#E5E7EB').stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF');
      doc.text('Documento no válido como factura — Presupuesto generado por Zupply', marginLeft, footerY, { width: pageWidth - 60, align: 'left' });
      doc.text(`Pág ${i + 1}/${totalPages}`, marginRight - 60, footerY, { width: 55, align: 'right' });
    }

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
