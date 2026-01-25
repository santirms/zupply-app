const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

const { requireAuth, requireRole } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');

// Si tenés una utilidad para zona por CP, importala (ajusta el path):
const { detectarZona } = require('../utils/detectarZona');
const { geocodeDireccion } = require('../utils/geocode');

router.use(requireAuth);
router.use(identifyTenant);

// POST /etiquetas/cargar-masivo
// Recibe etiquetas parseadas desde el frontend (después de leer el PDF)
router.post('/cargar-masivo', requireRole('admin','coordinador'), async (req, res) => {
  try {
    console.log('📦 Carga masiva - Body recibido:', { 
      tiene_etiquetas: !!req.body.etiquetas,
      tiene_envios: !!req.body.envios,
      cantidad: (req.body.etiquetas || req.body.envios || []).length
    });
    
    const etiquetas = req.body.etiquetas || req.body.envios;
    
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) {
      return res.status(400).json({ error: 'No se recibieron etiquetas.' });
    }

    const now = new Date();

    const docsPrep = await Promise.all(etiquetas.map(async et => {
      // Buscar cliente por sender_id
      const cl = await Cliente.findOne({ sender_id: et.sender_id });

      // Calcular fecha de etiqueta
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

      // Detectar zona si no viene en la etiqueta
      if (!partido || !zona) {
        try {
          const z = await detectarZona(cp);
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
            console.log(`✓ Geocodificado: ${et.direccion}, ${partido} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando:', geoError.message);
        }
      }

      return {
        meli_id:       et.tracking_id || '',
        sender_id:     et.sender_id   || '',
        cliente_id:    cl?._id        || null,
        codigo_postal: cp,
        partido,
        zona,
        destinatario:  et.destinatario || '',
        direccion:     et.direccion    || '',
        referencia:    et.referencia   || '',
        fecha:         fechaEtiqueta,
        id_venta:      et.id_venta || et.order_id || et.tracking_id || '',
        precio:        0,
        estado:        'en_planta',
        requiere_sync_meli: false,
        origen:        'etiquetas',
        source:        'pdf',
        latitud:       coordenadas?.lat || null,
        longitud:      coordenadas?.lon || null,
        destino: {
          partido: partido,
          cp: cp,
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        },
        tenantId: req.tenantId
      };
    }));

    const toInsert = docsPrep.filter(d => d.cliente_id);
    
    if (!toInsert.length) {
      return res.status(400).json({ error: 'Ninguna etiqueta tenía cliente válido.' });
    }
    
    const inserted = await Envio.insertMany(toInsert);
    
    console.log(`✅ Insertados ${inserted.length} envíos de ${etiquetas.length} etiquetas`);
    
    return res.json({ 
      intentados: etiquetas.length, 
      insertados: inserted.length 
    });
    
  } catch (err) {
    console.error('Error POST /etiquetas/cargar-masivo:', err);
    return res.status(500).json({ error: 'Error en carga masiva' });
  }
});

module.exports = router;
