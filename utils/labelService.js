// backend/utils/labelService.js
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const LABEL_SIZE = [283.46, 425.2]; // 10x15 cm

function resolveTracking(envio) {
  return (envio.id_venta && String(envio.id_venta).trim())
      || (envio.meli_id && String(envio.meli_id).trim())
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

  const qrBuffer = await QRCode.toBuffer(tracking, { width: 140, margin: 0 });

  doc.fontSize(18).text(envio.sender_id || 'Cliente', 12, 12, { width: LABEL_SIZE[0]-24 });
  doc.fontSize(22).text(tracking, { align: 'right' });

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

  doc.fontSize(28).text(tracking, 12, LABEL_SIZE[1] - 64, { width: LABEL_SIZE[0]-24, align: 'center' });

  doc.end();
  await new Promise(res => stream.on('finish', res));
  return { path: outPath, url: `/labels/${filename}`, tracking };
}

async function generarEtiquetaInformativa(envio, cliente) {
  const doc = new PDFDocument({
    size: [283.46, 425.2], // 10x15 cm (100x150mm)
    margins: { top: 20, bottom: 20, left: 20, right: 20 }
  });

  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // ===== ENCABEZADO =====

  // Badge del tipo (grande y destacado)
  const tipoBadges = {
    'envio': { texto: 'E', color: '#10b981' },
    'retiro': { texto: 'R', color: '#3b82f6' },
    'cambio': { texto: 'C', color: '#f59e0b' }
  };

  const badge = tipoBadges[envio.tipo] || tipoBadges['envio'];

  doc.fontSize(48)
     .fillColor(badge.color)
     .font('Helvetica-Bold')
     .text(badge.texto, 20, 20, { width: 60, align: 'center' });

  // Datos de la logística
  doc.fontSize(10)
     .fillColor('#000000')
     .font('Helvetica-Bold')
     .text('TRANSTECH SOLUCIONES LOGÍSTICAS', 90, 25);

  doc.fontSize(8)
     .font('Helvetica')
     .text('Av. Eva Perón 3777 (CP1834)', 90, 40)
     .text('WhatsApp: +54 9 11 6445-8579', 90, 52);

  // Línea separadora
  doc.moveTo(20, 75).lineTo(263, 75).stroke();

  // ===== CUERPO =====

  let y = 85;

  // QR Code (izquierda)
  const tracking = envio.tracking || envio.id_venta || envio.meli_id;
  
  const qrData = JSON.stringify({
   id: envio.id_venta || envio.meli_id,
   tracking: tracking,
   tipo: envio.tipo || 'envio'
 });
 

  const qrImage = await QRCode.toBuffer(qrData, {
    width: 100,
    margin: 1
  });

  doc.image(qrImage, 30, y, { width: 80, height: 80 });

  // ID y Fecha (derecha del QR)
  doc.fontSize(10)
     .font('Helvetica-Bold')
     .text(`ID: ${envio.id_venta}`, 120, y);

  doc.fontSize(8)
     .font('Helvetica')
     .text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 120, y + 15);

  y += 95;

  // Destinatario
  doc.fontSize(9)
     .font('Helvetica-Bold')
     .text('DESTINATARIO', 20, y);

  y += 15;

  doc.fontSize(10)
     .font('Helvetica-Bold')
     .text(envio.destinatario || 'N/A', 20, y);

  y += 15;

  doc.fontSize(9)
     .font('Helvetica')
     .text(envio.direccion || 'N/A', 20, y, { width: 240 });

  y += 20;

  doc.text(`${envio.partido || 'N/A'} (CP ${envio.codigo_postal || 'N/A'})`, 20, y);

  if (envio.telefono) {
    y += 15;
    doc.text(`Cel: ${envio.telefono}`, 20, y);
  }

  // Contenido (si existe)
  if (envio.contenido) {
    y += 20;
    doc.fontSize(8)
       .font('Helvetica-Bold')
       .text('CONTENIDO:', 20, y);

    y += 12;
    doc.font('Helvetica')
       .text(envio.contenido, 20, y, { width: 240 });
  }

  // Monto a cobrar (si aplica)
  if (envio.cobra_en_destino && envio.monto_a_cobrar) {
    y += 20;
    doc.fontSize(12)
       .fillColor('#dc2626')
       .font('Helvetica-Bold')
       .text(`COBRA: $${envio.monto_a_cobrar.toLocaleString('es-AR')}`, 20, y);

    doc.fillColor('#000000');
  }

  // ===== PIE =====

  // Línea separadora
  doc.moveTo(20, 365).lineTo(263, 365).stroke();

  // Info de Zupply (izquierda)
  doc.fontSize(8)
     .font('Helvetica-Bold')
     .fillColor('#6366f1')
     .text('Creado con Zupply', 20, 375);

  doc.fontSize(7)
     .font('Helvetica')
     .fillColor('#666666')
     .text('Software de última milla', 20, 388);

  doc.fontSize(6)
     .text(' www.zupply.tech | hola@zupply.tech', 20, 400);

  // QR Linktree (derecha)
  const linktreeQR = await QRCode.toBuffer('https://linktr.ee/zupply_tech', {
    width: 40,
    margin: 0
  });

  doc.image(linktreeQR, 220, 370, { width: 35, height: 35 });

  doc.fontSize(5)
     .fillColor('#666666')
     .text('LinkTree', 220, 407, { width: 35, align: 'center' });

  // Disclaimer
  doc.fontSize(5)
     .fillColor('#999999')
     .text('Zupply solo provee el software, la operadora es responsable del servicio.',
           20, 380, { width: 190, align: 'left' });

  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
}

module.exports = { buildLabelPDF, resolveTracking, generarEtiquetaInformativa };

