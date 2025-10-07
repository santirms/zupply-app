const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

function height(doc, text, width) {
  return doc.heightOfString(String(text ?? ''), { width });
}

async function buildRemitoPDF({ asignacion, chofer, envios, listaNombre }) {
  const dir = path.join(process.cwd(), 'public', 'remitos');
  fs.mkdirSync(dir, { recursive: true });

  const num = asignacion._id.toString().slice(-6).toUpperCase();
  const filename = `ASG-${num}.pdf`;
  const outPath  = path.join(dir, filename);

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const bufferPromise = new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Header
  doc.fontSize(18).text('Remito de salida');
  doc.moveDown(0.2);
  doc.fontSize(10)
     .text(`N°: ASG-${num}`)
     .text(`Fecha: ${dayjs(asignacion.fecha || asignacion.createdAt).format('DD/MM/YYYY')}`)
     .text(`Chofer: ${chofer?.nombre || ''}`);
  if (listaNombre) doc.text(`Lista (pago chofer): ${listaNombre}`); // 👈 reemplaza “Zona”
  doc.moveDown(0.6);

  // Título tabla
  doc.fontSize(11).text('Detalle de paquetes', { underline: true });
  doc.moveDown(0.3);

  // Cabeceras y anchos (sin “Destinatario”)
  const headers = ['Tracking', 'Cliente', 'Dirección', 'CP/Partido'];
  const widths  = [140, 120, 220, 100];
  const startX = doc.x;
  let y = doc.y;

  // Pintar cabecera en una línea
  let x = startX;
  headers.forEach((h,i) => {
    doc.text(h, x, y, { width: widths[i] });
    x += widths[i];
  });
  y += 16; // salto bajo cabecera
  doc.moveTo(startX, y-4).lineTo(startX + widths.reduce((a,b)=>a+b,0), y-4).strokeColor('#000').stroke();
  doc.fillColor('#000');

  // Filas alineadas: calcular alto máximo por fila y avanzar y
  doc.fontSize(10);
  envios.forEach(e => {
    const cells = [
      e.id_venta || e.meli_id || '',
      e.cliente_id?.nombre || e.sender_id || '',
      e.direccion || '',
      [e.codigo_postal||'', e.partido||''].filter(Boolean).join(' ')
    ];

    // altura de cada celda y máximo de la fila
    const heights = cells.map((txt,i) => height(doc, txt, widths[i]));
    const rowH = Math.max(...heights, 14);

    // pintar celdas en la misma y
    let cx = startX;
    cells.forEach((txt,i) => {
      doc.text(String(txt ?? ''), cx, y, { width: widths[i] });
      cx += widths[i];
    });

    y += rowH + 6; // avance controlado
    doc.y = y;
  });

  doc.moveDown(0.6);
  doc.fontSize(12).text(`TOTAL PAQUETES: ${envios.length}`, { align: 'right' });

  // 👉 firmas eliminadas

  doc.end();

  const [pdfBuffer] = await Promise.all([
    bufferPromise,
    new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    })
  ]);

  // ========== SUBIR A S3 CON URL PRE-FIRMADA ==========
  try {
    const bucketName = process.env.S3_BUCKET;

    if (!bucketName) {
      console.warn('S3_BUCKET no configurado, PDF solo en memoria');
      return { buffer: pdfBuffer, url: null };
    }

    // Cliente S3
    // ========== DEBUG TEMPORAL ==========
    console.log('🔍 Verificando credenciales AWS:');
    console.log('  S3_ACCESS_KEY_ID existe?', !!process.env.S3_ACCESS_KEY_ID);
    console.log('  S3_ACCESS_KEY_ID primeros 8 chars:', process.env.S3_ACCESS_KEY_ID?.substring(0, 8));
    console.log('  S3_SECRET_ACCESS_KEY existe?', !!process.env.S3_SECRET_ACCESS_KEY);
    console.log('  S3_SECRET_ACCESS_KEY primeros 8 chars:', process.env.S3_SECRET_ACCESS_KEY?.substring(0, 8));
    console.log('  S3_REGION:', process.env.S3_REGION);
    console.log('  S3_BUCKET:', process.env.S3_BUCKET);
    console.log('  Tipo de S3_ACCESS_KEY_ID:', typeof process.env.S3_ACCESS_KEY_ID);
    console.log('  Tipo de S3_SECRET_ACCESS_KEY:', typeof process.env.S3_SECRET_ACCESS_KEY);
    // ====================================

    const s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-2',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
      }
    });

    // Generar ruta S3
    const fecha = new Date(asignacion.fecha || Date.now());
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const asgId = String(asignacion._id || asignacion.id || Date.now());

    const s3Key = `remitos/${year}/${month}/${day}/${asgId}.pdf`;

    // Subir archivo a S3
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: Buffer.from(pdfBuffer),
      ContentType: 'application/pdf',
      Metadata: {
        'asignacion-id': asgId,
        'chofer-id': String(chofer?._id || ''),
        'chofer-nombre': String(chofer?.nombre || ''),
        'total-paquetes': String(envios?.length || 0),
        'fecha': fecha.toISOString()
      }
    });

    await s3Client.send(putCommand);

    // Generar URL pre-firmada válida por 15 días
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });

    const url = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 15 * 24 * 60 * 60 // 15 días en segundos (1,296,000 segundos)
    });

    console.log(`✓ Remito guardado en S3: ${s3Key}`);
    console.log(`✓ URL pre-firmada generada (válida 15 días)`);

    return { buffer: pdfBuffer, url, s3Key };
  } catch (error) {
    console.error('❌ Error subiendo remito a S3:', error.message);
    console.error('Stack:', error.stack);
    // No fallar la asignación si S3 falla
    return { buffer: pdfBuffer, url: null };
  }
}

module.exports = { buildRemitoPDF };
