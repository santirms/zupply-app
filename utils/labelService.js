// utils/labelService.js
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

// 10x15 cm => 283.46 x 425.2 pt
const LABEL_SIZE = [283.46, 425.2];

function resolveTracking(envio) {
  return (envio.id_venta && envio.id_venta.trim())
      || (envio.meli_id && envio.meli_id.trim())
      || '';
}

async function buildLabelPDF(envio) {
  const tracking = resolveTracking(envio);
  if (!tracking) throw new Error('No hay tracking (id_venta o meli_id)');

  const outDir = path.join(process.cwd(), 'public', 'labels');
  fs.mkdirSync(outDir, { recursive: true });

  const filename = `${tracking}.pdf`;
  const outPath  = path.join(outDir, filename);

  const doc = new PDFDocument({ size: LABEL_SIZE, margin: 12 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // QR del tracking (id_venta/meli_id)
  const qrBuffer = await QRCode.toBuffer(tracking, { width: 140, margin: 0 });

  // Header
  doc.fontSize(18).text(envio.sender_id || 'Cliente', 12, 12, { width: LABEL_SIZE[0]-24 });
  doc.fontSize(22).text(tracking, { align: 'right' });

  // QR a la derecha arriba
  doc.image(qrBuffer, LABEL_SIZE[0] - 12 - 120, 44, { width: 120 });

  const blockW = LABEL_SIZE[0] - 24 - 130;

  doc.moveDown(0.4);
  doc.fontSize(14).text(envio.destinatario || '', 12, 82, { width: blockW });
  doc.text(envio.direccion || '', { width: blockW });

  const loc = [envio.partido || envio.zona || '', envio.codigo_postal ? `(${envio.codigo_postal})` : '']
    .filter(Boolean).join(' ');
  if (loc) doc.text(loc, { width: blockW });

  if (envio.referencia) doc.text(`Ref: ${envio.referencia}`, { width: blockW });

  doc.moveDown(0.5);
  doc.fontSize(10).text(`Fecha: ${dayjs().format('DD/MM/YYYY')}`);

  // Tracking grande abajo
  doc.fontSize(28).text(tracking, 12, LABEL_SIZE[1] - 64, {
    width: LABEL_SIZE[0]-24, align: 'center'
  });

  doc.end();
  await new Promise(res => stream.on('finish', res));
  return { path: outPath, url: `/labels/${filename}`, tracking };
}

module.exports = { buildLabelPDF, resolveTracking };
