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
  // Buscar localidad desde la tabla de partidos si no viene en el envío
  let localidad = envio.localidad || null;

  if (!localidad && envio.codigo_postal) {
    try {
      const Partido = require('../models/partidos');
      const partidoDoc = await Partido.findOne({
        $or: [
          { codigo_postal: envio.codigo_postal },
          { codigos_postales: envio.codigo_postal }
        ]
      }).lean();

      if (partidoDoc?.localidad) {
        localidad = partidoDoc.localidad;
      }
    } catch (err) {
      console.warn('No se pudo obtener localidad:', err.message);
    }
  }

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

  console.log('Debug tipo badge:', {
  tipo: envio.tipo,
  badge: tipoBadges[envio.tipo]
  });
  const badge = tipoBadges[envio.tipo] || tipoBadges['envio'];

  doc.fontSize(48)
     .fillColor(badge.color)
     .font('Helvetica-Bold')
     .text(badge.texto, 20, 20, { width: 60, align: 'center' });

  // Datos de la logística
  doc.fontSize(10)
     .fillColor('#000000')
     .font('Helvetica-Bold')
     .text('TRANSTECH LOGÍSTICA', 90, 25);

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

  const qrData = envio.id_venta;  // Solo el ID
  
  const qrImage = await QRCode.toBuffer(qrData, {
    width: 100,
    margin: 1
  });

  doc.image(qrImage, 30, y, { width: 80, height: 80 });

  // ID y Fecha (derecha del QR)
  doc.fontSize(10)
     .font('Helvetica-Bold')
     .text(`ID: ${envio.id_venta}`, 120, y);

  doc.fontSize(10)  // ← Aumentado de 8 a 10
     .font('Helvetica')
     .text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 120, y + 15);

  y += 95;

  // Cliente (si existe)
  if (envio.cliente_id) {
    const nombreCliente = envio.cliente.nombre ||
                          envio.cliente_id.razon_social ||
                          'N/A';
    doc.fontSize(9)
       .font('Helvetica-Bold')
       .fillColor('#6366f1')  // Color distintivo (índigo)
       .text(`Cliente: ${nombreCliente}`, 20, y);
    doc.fillColor('#000000');  // Volver a negro
    y += 18;
  }

  // Destinatario
  doc.fontSize(9)
     .font('Helvetica-Bold')
     .text('DESTINATARIO', 20, y);

  y += 15;

  doc.fontSize(10)
     .font('Helvetica-Bold')
     .text(envio.destinatario || 'N/A', 20, y);

  y += 15;

  // Dirección principal
  doc.fontSize(9)
     .font('Helvetica')
     .text(envio.direccion || 'N/A', 20, y, { width: 240 });

  // Piso/Dpto (si existe)
  if (envio.piso_dpto) {
    y += 12;
    doc.fontSize(8)
       .text(envio.piso_dpto, 20, y, { width: 240 });
  }

  y += 20;

  // Armar texto: Localidad, Partido (CP xxxx)
  const ubicacionParts = [];
  if (localidad) ubicacionParts.push(localidad);
  if (envio.partido) ubicacionParts.push(envio.partido);
  const ubicacion = ubicacionParts.join(', ');
  const textoCompleto = `${ubicacion || 'N/A'} (CP ${envio.codigo_postal || 'N/A'})`;
  doc.text(textoCompleto, 20, y);

  if (envio.telefono) {
    y += 15;
    doc.text(`Cel: ${envio.telefono}`, 20, y);
  }

  // Referencia (contenido del paquete, instrucciones, etc)
  if (envio.referencia) {
    y += 15;
    doc.fontSize(8)
       .font('Helvetica-Bold')
       .text('Ref: ', 20, y);

    // Texto de referencia (puede ser largo, usar wrap)
    const refText = String(envio.referencia).substring(0, 80);
    doc.font('Helvetica')
       .text(refText, 42, y, { width: 200 });
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
  y += 25;
}

// Badge para CAMBIO
if (envio.tipo === 'cambio') {
  y += 15;
  
  doc.rect(20, y, 240, 30)
     .lineWidth(3)
     .stroke('#000000');
  
  doc.fontSize(12)
     .fillColor('#000000')
     .font('Helvetica-Bold')
     .text('!! CAMBIO - Retirar producto !!', 30, y + 10);
  
  y += 45;  // Espacio después del recuadro
}

// Badge para RETIRO
if (envio.tipo === 'retiro') {
  y += 15;
  
  doc.rect(20, y, 240, 30)
     .lineWidth(3)
     .stroke('#000000');
  
  doc.fontSize(12)
     .fillColor('#000000')
     .font('Helvetica-Bold')
     .text('!! RETIRO - Retirar producto !!', 30, y + 10);
  
  y += 45;
}
  
// ===== PIE =====
const footerY = 340;

// Línea separadora
doc.moveTo(20, footerY).lineTo(263, footerY).stroke();

// Info de Zupply (izquierda)
doc.fontSize(8)
   .font('Helvetica-Bold')
   .fillColor('#6366f1')
   .text('Creado con Zupply', 20, footerY + 10);

doc.fontSize(7)
   .font('Helvetica')
   .fillColor('#666666')
   .text('Software de última milla', 20, footerY + 23);  // footerY + 23

doc.fontSize(6)
   .fillColor('#000000')
   .text('www.zupply.tech | hola@zupply.tech', 20, footerY + 35);

// Disclaimer (debajo de todo)
doc.fontSize(5)
   .fillColor('#999999')
   .text('Zupply solo provee el software, la operadora es responsable del servicio.', 
         20, footerY + 48, { width: 190, align: 'left' });  // footerY + 48

// QR Linktree (derecha)
const linktreeQR = await QRCode.toBuffer('https://linktr.ee/zupply_tech', {
  width: 60,
  margin: 0
});

doc.image(linktreeQR, 210, footerY + 5, {  // X: de 220 a 210 (más a la izq)
  width: 50,
  height: 50
});

// Ajustar texto debajo
doc.fontSize(5)
   .fillColor('#666666')
   .text('Contacto', 210, footerY + 57, { width: 50, align: 'center' });

doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
}

module.exports = { buildLabelPDF, resolveTracking, generarEtiquetaInformativa };

