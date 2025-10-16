const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const Partido = require('../models/partidos'); // Asegurate que el path es correcto

const upload = multer({ dest: 'uploads/' });
const fsp = fs.promises;

router.post('/', upload.single('etiqueta'), async (req, res) => {
  let filePath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se adjuntó ningún archivo.' });
    }

    const pdfBuffer = await fsp.readFile(filePath);
    const data = await pdfParse(pdfBuffer);
    const { text, numpages } = data;

    const paginas = text
      .split(/\f+/)
      .map(p => p.trim())
      .filter(Boolean);

    console.log('📊 Información del PDF:', {
      totalPaginas: numpages,
      paginasDetectadas: paginas.length,
      rangoAProcesar: paginas.length ? `1 a ${paginas.length}` : '—'
    });

    const resultados = [];
    let procesadas = 0;

    for (let i = 0; i < paginas.length; i++) {
      const pagina = paginas[i];
      const numeroPagina = i + 1;
      console.log(`  📄 Procesando página ${numeroPagina} de ${paginas.length}`);

      try {
        const get = (regex) => {
          const match = pagina.match(regex);
          return match ? match[1].trim() : null;
        };

        const tracking_id = get(/Envio:\s?(\d+)/i);
        const codigo_postal = get(/CP:\s?(\d+)/i);

        let partido = 'Desconocido';
        let localidad = 'Desconocida';

        if (codigo_postal) {
          try {
            const cpDoc = await Partido.findOne({ codigo_postal });
            if (cpDoc) {
              partido = cpDoc.partido;
              localidad = cpDoc.localidad;
            }
          } catch (err) {
            console.warn(`    ⚠️ Error buscando CP ${codigo_postal}:`, err.message);
          }
        }

        resultados.push({
          tracking_id,
          sender_id: get(/#(\d+)/),
          fecha: get(/Entrega:\s?(.*)/),
          codigo_postal,
          partido,
          localidad,
          direccion: get(/Direccion:\s?([^\n]+)/i),
          referencia: get(/Ref(?:e|ie)rencia:\s?([^\n]+)/i),
          destinatario: get(/Destinatario:\s?([^\n]+)/i)
        });

        procesadas += 1;
        console.log(`  ✓ Página ${numeroPagina}/${paginas.length} procesada`);
      } catch (pageErr) {
        console.error(`  ❌ Error en página ${numeroPagina}:`, pageErr);
      }
    }

    console.log(`✅ Resultado: ${procesadas} de ${paginas.length} páginas procesadas`);
    if (procesadas < paginas.length) {
      console.warn(`⚠️ ATENCIÓN: Se perdieron ${paginas.length - procesadas} páginas`);
    }

    res.json({ etiquetas: resultados });
  } catch (error) {
    console.error('Error al leer etiquetas:', error);
    res.status(500).json({ error: 'No se pudo procesar el archivo PDF' });
  } finally {
    if (filePath) {
      fsp.unlink(filePath).catch(() => {});
    }
  }
});

module.exports = router;
