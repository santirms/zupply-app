const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

async function buildRemitoPDF({ asignacion, chofer, envios }) {
  const dir = path.join(process.cwd(), 'public', 'remitos');
  fs.mkdirSync(dir, { recursive: true });

  const num = asignacion._id.toString().slice(-6).toUpperCase();
  const filename = `ASG-${num}.pdf`;
  const outPath  = path.join(dir, filename);

  const doc = new PDFDocument({ size:'A4', margin:36 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  doc.fontSize(18).text('Remito de salida', { align:'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).text(`N°: ASG-${num}`);
  doc.text(`Fecha: ${dayjs(asignacion.fecha).format('DD/MM/YYYY HH:mm')}`);
  doc.text(`Chofer: ${chofer?.nombre || ''}`);
  doc.text(`Zona: ${asignacion.zona || ''}`);
  doc.moveDown(0.6);

  doc.fontSize(11).text('Detalle de paquetes', { underline:true });
  doc.moveDown(0.3);

  const headers = ['Tracking', 'Cliente', 'Dirección', 'CP/Partido'];
  const widths  = [140, 120, 220, 100];
  const startX = doc.x, startY = doc.y;
  headers.forEach((h,i)=>doc.text(h,startX+widths.slice(0,i).reduce((a,b)=>a+b,0),startY,{width:widths[i],continued:i<headers.length-1}));
  doc.moveDown(0.6);

  envios.forEach(e=>{
    const cells = [
      e.id_venta || e.meli_id || '',
      e.cliente_id?.nombre || '',
      e.direccion || '',
      [e.codigo_postal||'', e.partido||''].filter(Boolean).join(' ')
    ];
    let x = startX;
    cells.forEach((txt,i)=>{ doc.text(String(txt), x, doc.y, { width: widths[i] }); x += widths[i]; });
    doc.moveDown(0.2);
  });

  doc.moveDown(0.6);
  doc.fontSize(12).text(`TOTAL PAQUETES: ${envios.length}`, { align:'right' });

  doc.moveDown(1.2);
  doc.text('Firma Chofer: ____________________________', { continued:true });
  doc.text('   Firma Depósito: ____________________________');

  doc.end();
  await new Promise(res=>stream.on('finish',res));
  return { url: `/remitos/${filename}` };
}

module.exports = { buildRemitoPDF };
