const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Zona    = require('../models/Zona');

const { requireAuth, requireRole } = require('../middlewares/auth');

// Si tenés una utilidad para zona por CP, importala (ajusta el path):
const { detectarZona } = require('../utils/detectarZona');
const { geocodeDireccion } = require('../utils/geocode');

router.use(requireAuth);

// 🟢 ADMIN y COORDINADOR pueden subir etiquetas
router.post('/cargar-masivo', requireRole('admin','coordinador'), async (req, res) => {
  try {
    console.log('📦 Carga masiva - Body recibido:', { 
      tiene_etiquetas: !!req.body.etiquetas,
      tiene_envios: !!req.body.envios,
      cantidad: (req.body.etiquetas || req.body.envios || []).length
    });
    const { text: textoCompleto, numpages } = data;

console.log(`📄 PDF procesado: ${numpages} páginas, ${textoCompleto.length} caracteres`);

// ===== AGREGAR ESTAS LÍNEAS AQUÍ =====
console.log('📝 Texto extraído del PDF:');
console.log('─'.repeat(80));
console.log(textoCompleto);
console.log('─'.repeat(80));
// ===== FIN DE LAS LÍNEAS A AGREGAR =====

const bloques = textoCompleto.split(/(?=Envio:)/);
console.log(`📦 ${bloques.length} etiquetas detectadas`);
    const etiquetas = req.body.etiquetas || req.body.envios;
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) {
      console.log('❌ Error: No se recibieron etiquetas');
      return res.status(400).json({ error: 'No se recibieron etiquetas.' });
    }

    const now = new Date();

    const docsPrep = await Promise.all(etiquetas.map(async et => {
      const cl = await Cliente.findOne({ sender_id: et.sender_id });

      let fechaEtiqueta = now;
      if (et.fecha) {
        const parsed = new Date(et.fecha);
        if (!isNaN(parsed.getTime())) {
          fechaEtiqueta = new Date(
            now.getFullYear(),
            parsed.getMonth(),
            parsed.getDate(),
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
            now.getMilliseconds()
          );
        }
      }

      const cp = et.codigo_postal || '';
      let partido = (et.partido || '').trim();
      let zona    = (et.zona    || '').trim();

      if (!partido || !zona) {
        try {
          const z = await detectarZona(cp); // { partido, zona }
          if (!partido) partido = z?.partido || '';
          if (!zona)    zona    = z?.zona    || '';
        } catch { /* noop */ }
      }

      // Geocodificar dirección
      let coordenadas = null;
      if (et.direccion && partido) {
        try {
          coordenadas = await geocodeDireccion({
            direccion: et.direccion,
            codigo_postal: cp,
            partido: partido
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado etiqueta: ${et.direccion}, ${partido} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando etiqueta:', geoError.message);
        }
      }

      return {
        meli_id:       et.tracking_id      || '',
        sender_id:     et.sender_id        || '',
        cliente_id:    cl?._id             || null,
        codigo_postal: cp,
        partido,
        zona,
        destinatario:  et.destinatario     || '',
        direccion:     et.direccion        || '',
        referencia:    et.referencia       || '',
        fecha:         fechaEtiqueta,
        id_venta:      et.id_venta || et.order_id || et.tracking_id || '',
        precio:        0,
        estado:        'en_planta',
        requiere_sync_meli: false,
        origen:        'etiquetas',
        source:        'pdf', // 👈 marca origen etiquetas
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: partido,
          cp: cp,
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        }
      };
    }));

    const toInsert = docsPrep.filter(d => d.cliente_id);
    if (!toInsert.length) {
      return res.status(400).json({ error: 'Ninguna etiqueta tenía cliente válido.' });
    }
    const inserted = await Envio.insertMany(toInsert);
    return res.json({ intentados: etiquetas.length, insertados: inserted.length });
  } catch (err) {
    console.error('Error POST /etiquetas/cargar-masivo:', err);
    return res.status(500).json({ error: 'Error en carga masiva' });
  }
});

module.exports = router;
