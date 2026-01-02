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

  // Márgenes más amplios: 50px en lugar de 36px
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true // Importante para paginación correcta
  });

  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const bufferPromise = new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Función para pintar header en cada página
  function pintarHeader(paginaActual, totalPaginas) {
    doc.fontSize(18).font('Helvetica-Bold').text('Remito de salida', { align: 'center' });
    doc.moveDown(0.3);

    doc.fontSize(10).font('Helvetica');
    doc.text(`N°: ASG-${num}`, 50, doc.y);
    doc.text(`Fecha: ${dayjs(asignacion.fecha || asignacion.createdAt).format('DD/MM/YYYY')}`, 50, doc.y);
    doc.text(`Chofer: ${chofer?.nombre || ''}`, 50, doc.y);
    if (listaNombre) doc.text(`Lista (pago chofer): ${listaNombre}`, 50, doc.y);

    // TOTAL ARRIBA (destacado)
    doc.fontSize(12).font('Helvetica-Bold')
       .fillColor('#2563eb')
       .text(`TOTAL PAQUETES: ${envios.length}`, 50, doc.y, { align: 'right' });
    doc.fillColor('#000000');

    // Número de página si hay más de una
    if (totalPaginas > 1) {
      doc.fontSize(9).font('Helvetica')
         .text(`Página ${paginaActual} de ${totalPaginas}`, 50, doc.y, { align: 'right' });
    }

    doc.moveDown(0.5);
  }

  // Configuración de tabla
  const headers = ['Tracking', 'Cliente', 'Dirección', 'CP/Partido'];
  const widths  = [130, 110, 210, 90]; // Ajustado para márgenes de 50px
  const pageHeight = doc.page.height;
  const bottomMargin = 80; // Margen inferior para no cortar
  const maxY = pageHeight - bottomMargin;

  // Primera pasada: calcular cuántas páginas necesitamos
  const rowsPerPage = [];
  let currentPageRows = [];
  let testY = 150; // Posición Y inicial después del header

  doc.fontSize(10).font('Helvetica');

  envios.forEach((e, idx) => {
    const cells = [
      e.id_venta || e.meli_id || '',
      e.cliente_id?.nombre || e.cliente_id?.razon_social || e.sender_id || '',
      e.direccion || '',
      [e.codigo_postal||'', e.partido||''].filter(Boolean).join(' ')
    ];

    const heights = cells.map((txt, i) => height(doc, txt, widths[i]));
    const rowH = Math.max(...heights, 14);

    // Si esta fila no cabe en la página actual
    if (testY + rowH + 6 > maxY) {
      rowsPerPage.push([...currentPageRows]);
      currentPageRows = [idx];
      testY = 150 + rowH + 6; // Reset para nueva página
    } else {
      currentPageRows.push(idx);
      testY += rowH + 6;
    }
  });

  // Agregar última página
  if (currentPageRows.length > 0) {
    rowsPerPage.push(currentPageRows);
  }

  const totalPaginas = rowsPerPage.length;

  // Segunda pasada: pintar el PDF página por página
  rowsPerPage.forEach((rows, pageIdx) => {
    const paginaActual = pageIdx + 1;

    // Nueva página si no es la primera
    if (pageIdx > 0) {
      doc.addPage();
    }

    // Pintar header
    pintarHeader(paginaActual, totalPaginas);

    // Título de tabla
    doc.fontSize(11).font('Helvetica-Bold')
       .text('Detalle de paquetes', 50, doc.y, { underline: true });
    doc.moveDown(0.3);

    // Cabeceras
    const startX = 50;
    let y = doc.y;
    let x = startX;

    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: widths[i], align: 'left' });
      x += widths[i];
    });

    y += 16;
    doc.moveTo(startX, y - 4)
       .lineTo(startX + widths.reduce((a,b) => a+b, 0), y - 4)
       .strokeColor('#cccccc')
       .lineWidth(1)
       .stroke();
    doc.fillColor('#000000');

    // Filas de esta página
    doc.fontSize(9).font('Helvetica');

    rows.forEach(envioIdx => {
      const e = envios[envioIdx];
      const cells = [
        e.id_venta || e.meli_id || '',
        e.cliente_id?.nombre || e.cliente_id?.razon_social || e.sender_id || '',
        e.direccion || '',
        [e.codigo_postal||'', e.partido||''].filter(Boolean).join(' ')
      ];

      const heights = cells.map((txt, i) => height(doc, txt, widths[i]));
      const rowH = Math.max(...heights, 14);

      let cx = startX;
      cells.forEach((txt, i) => {
        doc.text(String(txt ?? ''), cx, y, {
          width: widths[i],
          align: i === 0 ? 'left' : 'left' // Todo alineado a izquierda
        });
        cx += widths[i];
      });

      y += rowH + 4;
    });
  });

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

    const s3Client = new S3Client({
      region: process.env.S3_REGION || 'us-east-2',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
      }
    });

    const fecha = new Date(asignacion.fecha || Date.now());
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    const asgId = String(asignacion._id || asignacion.id || Date.now());

    const s3Key = `remitos/${year}/${month}/${day}/${asgId}.pdf`;

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

    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });

    const url = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 7 * 24 * 60 * 60
    });

    console.log(`✓ Remito guardado en S3: ${s3Key}`);
    console.log(`✓ URL pre-firmada generada (válida 7 días)`);

    return { buffer: pdfBuffer, url, s3Key };
  } catch (error) {
    console.error('❌ Error subiendo remito a S3:', error.message);
    return { buffer: pdfBuffer, url: null };
  }
}

module.exports = { buildRemitoPDF };
