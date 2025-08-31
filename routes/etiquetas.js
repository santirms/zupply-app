const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Zona    = require('../models/Zona');

const { requireAuth, requireRole } = require('../middlewares/auth');

// Si tenés una utilidad para zona por CP, importala (ajusta el path):
const { detectarZona } = require('../utils/detectarZona');

router.use(requireAuth);

// 🟢 ADMIN y COORDINADOR pueden subir etiquetas
router.post('/cargar-masivo', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const etiquetas = req.body.etiquetas || req.body.envios;
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) {
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
        source:        'pdf' // 👈 marca origen etiquetas
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
