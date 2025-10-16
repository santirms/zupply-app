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
    const { text: textoCompleto, numpages } = data;

    console.log(`📄 PDF procesado: ${numpages} páginas, ${textoCompleto.length} caracteres`);

    const bloques = textoCompleto.split(/(?=Envio:)/);
    console.log(`📦 ${bloques.length} etiquetas detectadas`);

    const etiquetasValidas = bloques.filter(bloque => bloque.trim().length > 0);
    console.log(`✓ ${etiquetasValidas.length} etiquetas válidas para procesar`);

    const resultados = [];
    let procesadas = 0;
    const errores = [];

    const extraer = (texto, regex) => {
      const match = texto.match(regex);
      return match ? match[1].trim() : null;
    };

    for (let i = 0; i < etiquetasValidas.length; i++) {
      const bloque = etiquetasValidas[i];
      console.log(`\n--- Procesando etiqueta ${i + 1}/${etiquetasValidas.length} ---`);

      try {
        const tracking =
          extraer(bloque, /Tracking:\s*([^\n\r]+)/i) ||
          extraer(bloque, /Envio:\s*([^\n\r]+)/i);

        if (!tracking) {
          console.warn(`⚠️ Etiqueta ${i + 1}: Sin tracking ni número de envío, saltando`);
          errores.push({
            etiqueta: i + 1,
            error: 'Sin tracking ni número de envío',
            texto: bloque.substring(0, 100)
          });
          continue;
        }

        const codigo_postal =
          extraer(bloque, /CP:\s*(\d{4,})/i) ||
          extraer(bloque, /Codigo Postal:\s*(\d{4,})/i);

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
          tracking_id: tracking,
          sender_id: extraer(bloque, /#(\d+)/),
          fecha: extraer(bloque, /Entrega:\s*([^\n\r]+)/i),
          codigo_postal,
          partido,
          localidad,
          direccion: extraer(bloque, /Direccion:\s*([^\n\r]+)/i),
          referencia: extraer(bloque, /Ref(?:e|ie)rencia:\s*([^\n\r]+)/i),
          destinatario: extraer(bloque, /Destinatario:\s*([^\n\r]+)/i)
        });

        procesadas += 1;
        console.log(`  ✓ Etiqueta ${i + 1}/${etiquetasValidas.length} procesada`);
      } catch (pageErr) {
        console.error(`  ❌ Error procesando etiqueta ${i + 1}:`, pageErr);
        errores.push({
          etiqueta: i + 1,
          error: pageErr.message,
          texto: bloque.substring(0, 100)
        });
      }
    }

    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`✅ Resultado final:`);
    console.log(`   Total etiquetas: ${etiquetasValidas.length}`);
    console.log(`   Creados: ${procesadas}`);
    console.log(`   Errores: ${errores.length}`);
    console.log(`═══════════════════════════════════════════════════════\n`);

    res.json({
      etiquetas: resultados,
      resumen: {
        total: etiquetasValidas.length,
        procesadas,
        errores: errores.length,
        detalleErrores: errores
      }
    });
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
