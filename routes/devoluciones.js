const express = require('express');
const router  = express.Router();
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Chofer  = require('../models/Chofer');
const { requireRole } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');

router.use(identifyTenant);

// Estados que permiten devolución
const ESTADOS_DEVOLVIBLES = [
  'cancelado', 'no_entregado', 'comprador_ausente',
  'devuelto', 'delivery_failed', 'incidencia', 'devolucion'
];

/* -------------------------------------------------------
 * GET /pendientes?clienteId=XXX
 * Envíos del cliente con estado devolvible
 * ----------------------------------------------------- */
router.get('/pendientes', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const { clienteId } = req.query;
    if (!clienteId) return res.status(400).json({ error: 'Falta clienteId' });

    const cliente = await Cliente.findOne({ _id: clienteId, tenantId: req.tenantId });
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const senderIds = cliente.sender_id || [];
    if (!senderIds.length) return res.json({ items: [] });

    const items = await Envio.find({
      tenantId: req.tenantId,
      sender_id: { $in: senderIds },
      estado: { $in: ESTADOS_DEVOLVIBLES }
    })
      .select('meli_id id_venta destinatario direccion partido estado fecha sender_id')
      .sort({ fecha: -1 })
      .lean();

    res.json({ items });
  } catch (err) {
    console.error('Error en GET /devoluciones/pendientes:', err);
    res.status(500).json({ error: 'Error al buscar envíos pendientes de devolución' });
  }
});

/* -------------------------------------------------------
 * POST /remito
 * Genera PDF del remito de devolución
 * Body: { clienteId, choferId, envioIds: [...] }
 * ----------------------------------------------------- */
router.post('/remito', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const { clienteId, choferId, envioIds } = req.body;
    if (!clienteId || !envioIds?.length) {
      return res.status(400).json({ error: 'Faltan clienteId o envioIds' });
    }

    const [cliente, chofer, envios] = await Promise.all([
      Cliente.findOne({ _id: clienteId, tenantId: req.tenantId }),
      choferId ? Chofer.findOne({ _id: choferId, tenantId: req.tenantId }) : null,
      Envio.find({ _id: { $in: envioIds }, tenantId: req.tenantId }).lean()
    ]);

    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (!envios.length) return res.status(404).json({ error: 'No se encontraron envíos' });

    const nroRemito = String(Date.now()).slice(-8);
    const hoy = dayjs().format('DD/MM/YYYY');

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="remito-devolucion-${nroRemito}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold')
       .text('REMITO DE DEVOLUCIÓN', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica')
       .text(`N°: ${nroRemito}`, { align: 'right' });
    doc.text(`Fecha: ${hoy}`, { align: 'right' });
    doc.moveDown(0.8);

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Cliente receptor
    doc.fontSize(12).font('Helvetica-Bold').text('CLIENTE RECEPTOR');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Nombre: ${cliente.nombre || ''}`);
    doc.text(`Código: ${cliente.codigo_cliente || ''}`);
    if (cliente.razon_social) doc.text(`Razón Social: ${cliente.razon_social}`);
    doc.moveDown(0.5);

    // Chofer / Transportista
    doc.fontSize(12).font('Helvetica-Bold').text('CHOFER / TRANSPORTISTA');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Nombre: ${chofer?.nombre || 'No asignado'}`);
    doc.moveDown(0.5);

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Tabla de paquetes
    doc.fontSize(12).font('Helvetica-Bold').text('Detalle de paquetes', { underline: true });
    doc.moveDown(0.3);

    const headers = ['#', 'ID Venta / Tracking', 'Destinatario', 'Estado'];
    const widths  = [30, 180, 170, 115];
    const startX  = 50;

    // Cabeceras
    let y = doc.y;
    let x = startX;
    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: widths[i], align: 'left' });
      x += widths[i];
    });

    y += 16;
    doc.moveTo(startX, y - 4)
       .lineTo(startX + widths.reduce((a, b) => a + b, 0), y - 4)
       .strokeColor('#ccc').lineWidth(1).stroke();
    doc.fillColor('#000');

    // Filas
    doc.fontSize(9).font('Helvetica');
    const pageHeight = doc.page.height;
    const bottomMargin = 160; // Espacio para firma

    envios.forEach((e, idx) => {
      if (y + 20 > pageHeight - bottomMargin) {
        doc.addPage();
        y = 50;
      }

      const cells = [
        String(idx + 1),
        e.id_venta || e.meli_id || '',
        e.destinatario || '',
        e.estado || ''
      ];

      x = startX;
      cells.forEach((txt, i) => {
        doc.text(String(txt ?? ''), x, y, { width: widths[i], align: 'left' });
        x += widths[i];
      });

      y += 16;
    });

    // Total
    doc.moveDown(0.5);
    y = doc.y;
    doc.fontSize(11).font('Helvetica-Bold')
       .text(`Total paquetes: ${envios.length}`, startX, y);
    doc.moveDown(0.5);

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').lineWidth(1).stroke();
    doc.moveDown(1);

    // Sección de firma
    doc.fontSize(11).font('Helvetica-Bold').text('Firma del Cliente:');
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica')
       .text('____________________________');
    doc.text('Aclaración:');
    doc.moveDown(0.8);
    doc.text('____________________________');
    doc.text('DNI:');
    doc.moveDown(0.8);
    doc.text('____________________________');
    doc.moveDown(0.5);
    doc.text('Fecha y hora de recepción: ___/___/____  ___:___');
    doc.moveDown(1);

    // Footer
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica')
       .fillColor('#666')
       .text('Documento generado por Zupply — No válido como factura', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Error en POST /devoluciones/remito:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al generar remito' });
    }
  }
});

/* -------------------------------------------------------
 * POST /confirmar
 * Confirma la devolución: cambia estado a devuelto_a_cliente
 * Body: { clienteId, choferId, envioIds: [...], nroRemito }
 * ----------------------------------------------------- */
router.post('/confirmar', requireRole('admin', 'coordinador'), async (req, res) => {
  try {
    const { clienteId, choferId, envioIds, nroRemito } = req.body;
    if (!clienteId || !envioIds?.length) {
      return res.status(400).json({ error: 'Faltan clienteId o envioIds' });
    }

    const remito = nroRemito || String(Date.now()).slice(-8);
    const chofer = choferId
      ? await Chofer.findOne({ _id: choferId, tenantId: req.tenantId })
      : null;
    const userEmail = req.session?.user?.email || 'sistema';

    const result = await Envio.updateMany(
      {
        _id: { $in: envioIds },
        tenantId: req.tenantId,
        estado: { $ne: 'devuelto_a_cliente' } // No re-procesar
      },
      {
        $set: { estado: 'devuelto_a_cliente' },
        $push: {
          historial: {
            estado: 'devuelto_a_cliente',
            at: new Date(),
            source: 'zupply:devolucion',
            actor_name: userEmail,
            note: `Devuelto a cliente via remito #${remito}`,
            metadata: { choferId: choferId || null, nroRemito: remito, clienteId }
          },
          historial_estados: {
            estado: 'devuelto_a_cliente',
            fecha: new Date(),
            usuario: userEmail,
            notas: `Remito #${remito} - Chofer: ${chofer?.nombre || 'N/A'}`
          }
        }
      }
    );

    res.json({ ok: true, updated: result.modifiedCount, nroRemito: remito });
  } catch (err) {
    console.error('Error en POST /devoluciones/confirmar:', err);
    res.status(500).json({ error: 'Error al confirmar devolución' });
  }
});

module.exports = router;
