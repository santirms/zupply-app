// routes/envios.js
const express = require('express');
const router  = express.Router();
const Zona    = require('../models/Zona');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { geocodeDireccion } = require('../utils/geocode');

// ⬇️ NUEVO: importo solo lo que ya tenés en el controller
const { getEnvioByTracking } = require('../controllers/envioController');

// GET /envios
router.get('/', async (req, res) => {
  try {
    const { sender_id, desde, hasta } = req.query;
    const filtro = {};
    if (sender_id) filtro.sender_id = sender_id;
    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = new Date(desde);
      if (hasta) filtro.fecha.$lte = new Date(hasta);
    }

    // 1) Traer envíos con cliente + lista_precios
    let envios = await Envio.find(filtro)
      .populate({
        path: 'cliente_id',
        populate: { path: 'lista_precios', model: 'ListaDePrecios' }
      });

    // 2) Procesar cada envío
    envios = await Promise.all(envios.map(async envioDoc => {
      const e = envioDoc.toObject();

      // a) Determinar nombre de zona (puede estar en e.zona o e.partido)
      const zonaName = e.zona || e.partido || '';

      // b) Calcular precio si no viene
      if (typeof e.precio !== 'number' || e.precio <= 0) {
        let costo = 0;
        const cl = e.cliente_id;
        if (cl?.lista_precios) {
          const zonaDoc = await Zona.findOne({ partidos: zonaName });
          if (zonaDoc) {
            const zp = cl.lista_precios.zonas.find(z =>
              z.zona.toString() === zonaDoc._id.toString()
            );
            costo = zp?.precio ?? 0;
          }
        }
        e.precio = costo;
      }

      // c) Unificamos ambos campos para el front
      e.zona    = zonaName;
      e.partido = zonaName;

      return e;
    }));

    return res.json(envios);
  } catch (err) {
    console.error('Error GET /envios:', err);
    return res.status(500).json({ error: 'Error al obtener envíos' });
  }
});

// POST /guardar-masivo
router.post('/guardar-masivo', async (req, res) => {
  try {
    const paquetes = req.body;
    console.log('guardar-masivo payload:', paquetes);
    if (!Array.isArray(paquetes) || paquetes.length === 0) {
      return res.status(400).json({ error: 'No hay paquetes para guardar.' });
    }
    const clienteId = paquetes[0].clienteId || paquetes[0].cliente_id;
    const cliente   = await Cliente.findById(clienteId);
    if (!cliente) {
      return res.status(400).json({ error: 'Cliente no encontrado.' });
    }

    const docs = paquetes.map(p => ({
      cliente_id:    cliente._id,
      sender_id:     cliente.codigo_cliente,
      destinatario:  p.destinatario      || '',
      direccion:     p.direccion          || '',
      codigo_postal: p.codigo_postal      || p.cp || '',
      zona:          p.zona               || '',
      id_venta:      p.idVenta            || p.id_venta || '',
      referencia:    p.referencia         || '',
      fecha:         new Date(),
      precio:        p.manual_precio      ? Number(p.precio) || 0 : 0
      // precio real se calculará en GET /envios si es 0
    }));

    const inserted = await Envio.insertMany(docs);
    console.log(`guardar-masivo: insertados ${inserted.length}`);
    return res.status(201).json({ inserted: inserted.length, docs: inserted });
  } catch (err) {
    console.error('Error POST /guardar-masivo:', err);
    return res.status(500).json({ error: 'Error al guardar envíos masivos' });
  }
});

// POST /cargar-masivo
router.post('/cargar-masivo', async (req, res) => {
  try {
    const etiquetas = req.body.etiquetas || req.body.envios;
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) {
      return res.status(400).json({ error: 'No se recibieron etiquetas.' });
    }

    const docsPrep = await Promise.all(etiquetas.map(async et => {
      // 1) Buscamos cliente
      const cl = await Cliente.findOne({ sender_id: et.sender_id });

      // 2) Calculamos fecha combinando día/mes del PDF y año/hora actual
      const now = new Date();
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

      return {
        meli_id:       et.tracking_id      || '',
        sender_id:     et.sender_id        || '',
        cliente_id:    cl?._id             || null,
        codigo_postal: et.codigo_postal    || '',
        zona:          et.zona             || et.partido || '',
        destinatario:  et.destinatario     || '',
        direccion:     et.direccion        || '',
        referencia:    et.referencia       || '',
        // 3) Usamos la fecha combinada aquí:
        fecha:         fechaEtiqueta,
        id_venta:      et.tracking_id      || '',
        precio:        0
      };
    }));

    // 4) Filtrar y guardar
    const toInsert = docsPrep.filter(d => d.cliente_id);
    if (!toInsert.length) {
      return res.status(400).json({ error: 'Ninguna etiqueta tenía cliente válido.' });
    }
    const inserted = await Envio.insertMany(toInsert);
    return res.json({
      intentados: etiquetas.length,
      insertados: inserted.length
    });

  } catch (err) {
    console.error('Error POST /cargar-masivo:', err);
    return res.status(500).json({ error: 'Error en carga masiva' });
  }
});

// POST /manual
router.post('/manual', async (req, res) => {
  try {
    const { paquetes } = req.body;
    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes.' });
    }

    const docs = await Promise.all(paquetes.map(async p => {
      // 1) Cliente
      const cl = await Cliente.findById(p.cliente_id)
                              .populate('lista_precios');
      if (!cl) throw new Error('Cliente no encontrado');

      // 2) Generar idVenta si falta
      const idVenta = (p.id_venta || p.idVenta || '').trim() ||
                      Math.random().toString(36).substr(2,8).toUpperCase();

      // 3) Determinar zonaName = p.zona o p.partido
      const zonaName = p.zona || p.partido || '';

      // 4) Precio manual o de lista
      let costo = 0;
      if (p.manual_precio) {
        costo = Number(p.precio) || 0;
      } else {
        const zonaDoc = await Zona.findOne({ partidos: zonaName });
        if (zonaDoc && cl.lista_precios) {
          const zp = cl.lista_precios.zonas.find(z =>
            z.zona.toString() === zonaDoc._id.toString()
          );
          costo = zp?.precio ?? 0;
        }
      }

      // 5) Armamos el documento
      return new Envio({
        cliente_id:    cl._id,
        sender_id:     cl.codigo_cliente,
        destinatario:  p.destinatario,
        direccion:     p.direccion,
        codigo_postal: p.codigo_postal,
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      idVenta,
        referencia:    p.referencia,
        precio:        costo,
        fecha:         new Date()
      }).save();
    }));

    return res.status(201).json({ inserted: docs.length, docs });
  } catch (err) {
    console.error('Error POST /envios/manual:', err);
    return res.status(500).json({ error: err.message || 'Error al guardar envíos manuales' });
  }
});

// GET /del-dia
router.get('/del-dia', async (req, res) => {
  try {
    const ahora = new Date();
    const hoy13 = new Date(); hoy13.setHours(13,0,0,0);

    let desde, hasta;
    if (ahora < hoy13) {
      desde = new Date(hoy13); desde.setDate(desde.getDate()-1);
      hasta = hoy13;
    } else {
      desde = hoy13;
      hasta = new Date(hoy13); hasta.setDate(hasta.getDate()+1);
    }

    const enviosDelDia = await Envio.find({ fecha: { $gte: desde, $lt: hasta } });
    res.json({ total: enviosDelDia.length, envios: enviosDelDia });
  } catch (err) {
    console.error('Error al obtener envíos del día:', err);
    res.status(500).json({ error: 'Error al obtener envíos del día' });
  }
});

// ⬇️ NUEVO: QR por tracking (PONER ANTES de '/:id')
router.get('/tracking/:tracking', getEnvioByTracking);

// Helper: completa y guarda coords si faltan
async function ensureCoords(envio) {
  if (!envio) return envio;
  if ((envio.latitud && envio.longitud) || !envio.direccion) return envio;

  const hit = await geocodeDireccion({
    direccion: envio.direccion,
    codigo_postal: envio.codigo_postal,
    partido: envio.partido || envio.zona
  });
  if (hit) {
    envio.latitud = hit.lat;
    envio.longitud = hit.lon;
    await envio.save();
  }
  return envio;
}

// GET /envios/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const envio = await Envio.findById(id)
      .populate('cliente_id')
      .lean();

    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    await ensureCoords(envio);   // ⬅️ completa lat/lng si faltan
    res.json(envio);
  } catch (err) {
    console.error('Error al obtener envío:', err);
    res.status(500).json({ error: 'Error al obtener envío' });
  }
});

// PATCH /envios/:id/geocode  (forzar desde el front)
router.patch('/:id/geocode', async (req, res) => {
  try {
    const envio = await Envio.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    await ensureCoords(envio);
    if (!envio.latitud || !envio.longitud) {
      return res.status(404).json({ error: 'No se pudo geocodificar' });
    }
    res.json({ ok: true, latitud: envio.latitud, longitud: envio.longitud });
  } catch (err) {
    console.error('Error PATCH geocode:', err);
    res.status(500).json({ error: 'Error al geocodificar' });
  }
});

// DELETE /envios/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Envio.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: 'Envío no encontrado' });
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('Error DELETE /envios/:id:', err);
    return res.status(500).json({ error: 'Error al eliminar envío' });
  }
});

module.exports = router;
