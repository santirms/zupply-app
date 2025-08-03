const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const Partido = require('../models/partidos'); // Asegurate que el path es correcto

const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('etiqueta'), async (req, res) => {
  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(pdfBuffer);
    const texto = data.text;

    const bloques = texto.split(/Envio:\s?\d+/).slice(1);
    const trackingMatch = texto.match(/Envio:\s?\d+/g);
    const resultados = [];

    for (let index = 0; index < bloques.length; index++) {
      const bloque = bloques[index];
      const get = (regex) => {
        const match = bloque.match(regex);
        return match ? match[1].trim() : null;
      };

      const tracking_id = trackingMatch && trackingMatch[index]
        ? trackingMatch[index].match(/\d+/)?.[0] || null
        : null;

      const cpMatch = bloque.match(/CP:\s?(\d+)/);
      const codigo_postal = cpMatch ? cpMatch[1] : null;

      let partido = 'Desconocido';
      let localidad = 'Desconocida';

      if (codigo_postal) {
        const cpDoc = await Partido.findOne({ codigo_postal: codigo_postal });
        if (cpDoc) {
          partido = cpDoc.partido;
          localidad = cpDoc.localidad;
        }
      }

      resultados.push({
        tracking_id,
        sender_id: get(/#(\d+)/),
        fecha: get(/Entrega:\s?(.*)/),
        codigo_postal,
        partido,
        localidad,
        direccion: get(/Direccion:\s?([^\n]+)/),
        referencia: get(/Ref(?:e|ie)rencia:\s?([^\n]+)/), // Corrige 'Refierencia' y 'Referencia'
        destinatario: get(/Destinatario:\s?([^\n]+)/)
      });
    }

    fs.unlinkSync(req.file.path);
    res.json({ etiquetas: resultados });

  } catch (error) {
    console.error("Error al leer etiquetas:", error);
    res.status(500).json({ error: 'No se pudo procesar el archivo PDF' });
  }
});

module.exports = router;
