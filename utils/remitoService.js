const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

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
  await new Promise(res => stream.on('finish', res));
  return { url: `/remitos/${filename}` };
}

module.exports = { buildRemitoPDF };
