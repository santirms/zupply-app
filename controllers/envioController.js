// backend/controllers/envioController.js
const Envio = require('../models/Envio');
const QRCode = require('qrcode');
const { buildLabelPDF, resolveTracking } = require('../utils/labelService');

// Usa tu util real; en tus otros archivos es geocodeDireccion desde ../utils/geocode
let geocodeDireccion = async () => ({ lat: null, lon: null });
try {
  ({ geocodeDireccion } = require('../utils/geocode'));
} catch (e) {
  console.warn('geocode util no disponible, sigo sin geocodificar');
}

// Crear un envío manual (y geolocalizarlo opcionalmente)
exports.crearEnvio = async (req, res) => {
  try {
    const {
      sender_id,
      cliente_id,
      id_venta,       // 👈 este es TU tracking
      meli_id,
      codigo_postal,
      zona,
      partido,
      destinatario,
      direccion,
      referencia
    } = req.body;

    // Geocode (si tenés util disponible)
    let latitud = null, longitud = null;
    if (direccion || codigo_postal || partido) {
      const q = [direccion, codigo_postal, partido, 'Argentina'].filter(Boolean).join(', ');
      const coords = await geocodeDireccion(q);
      // Tus campos de esquema son latitud / longitud
      latitud  = coords?.lat ?? null;
      longitud = coords?.lon ?? coords?.lng ?? null;
    }

    const nuevo = await Envio.create({
      sender_id,
      cliente_id,
      id_venta,      // 👈 tracking del sistema
      meli_id,
      codigo_postal,
      zona,
      partido,
      destinatario,
      direccion,
      referencia,
      latitud,       // 👈 coincide con el schema
      longitud,      // 👈 coincide con el schema
      fecha: new Date()
    });

    // Generar etiqueta 10x15 + QR usando id_venta (o meli_id)
    const { url } = await buildLabelPDF(nuevo.toObject());
    const tk = resolveTracking(nuevo);
    const qr_png = await QRCode.toDataURL(tk, { width: 256, margin: 0 });
    await Envio.updateOne({ _id: nuevo._id }, { $set: { label_url: url, qr_png } });

    const doc = await Envio.findById(nuevo._id).lean();
    res.status(201).json(doc);
  } catch (err) {
    console.error('Error crearEnvio:', err);
    res.status(500).json({ error: 'Error al crear envío' });
  }
};

// Listar envíos
exports.listarEnvios = async (req, res) => {
  try {
    const envios = await Envio.find().lean();
    res.json(envios);
  } catch (err) {
    console.error('Error listarEnvios:', err);
    res.status(500).json({ error: 'Error al listar envíos' });
  }
};

// Buscar por tracking del sistema (id_venta) o por meli_id
exports.getEnvioByTracking = async (req, res) => {
  try {
    const tracking = req.params.tracking || req.params.trackingId;
    let envio = await Envio.findOne({ id_venta: tracking }).lean()
             || await Envio.findOne({ meli_id: tracking }).lean();

    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });

    // Si no tiene etiqueta, generarla on-demand
    if (!envio.label_url) {
      const { url } = await buildLabelPDF(envio);
      const tk = resolveTracking(envio);
      const qr_png = await QRCode.toDataURL(tk, { width: 256, margin: 0 });
      await Envio.updateOne({ _id: envio._id }, { $set: { label_url: url, qr_png } });
      envio = await Envio.findById(envio._id).lean();
    }

    res.json(envio);
  } catch (err) {
    console.error('Error getEnvioByTracking:', err);
    res.status(500).json({ error: 'Error al buscar envío' });
  }
};

// Redirigir al PDF de etiqueta (si no existe, lo genera)
exports.labelByTracking = async (req, res) => {
  try {
    const tracking = req.params.tracking || req.params.trackingId;
    const envio = await Envio.findOne({ id_venta: tracking })
               || await Envio.findOne({ meli_id: tracking });
    if (!envio) return res.status(404).send('No encontrado');

    if (envio.label_url) return res.redirect(envio.label_url);

    const { url } = await buildLabelPDF(envio.toObject());
    await Envio.updateOne({ _id: envio._id }, { $set: { label_url: url } });
    res.redirect(url);
  } catch (e) {
    console.error('labelByTracking error:', e);
    res.status(500).send('Error al generar/servir etiqueta');
  }
};

// Actualizar (re-geocode si cambia dirección)
exports.actualizarEnvio = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.direccion || updates.codigo_postal || updates.partido) {
      const q = [updates.direccion, updates.codigo_postal, updates.partido, 'Argentina'].filter(Boolean).join(', ');
      const coords = await geocodeDireccion(q);
      updates.latitud  = coords?.lat ?? null;
      updates.longitud = coords?.lon ?? coords?.lng ?? null;
    }
    const envio = await Envio.findByIdAndUpdate(req.params.id, updates, { new: true }).lean();
    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });
    res.json(envio);
  } catch (err) {
    console.error('Error actualizarEnvio:', err);
    res.status(500).json({ error: 'Error al actualizar envío' });
  }
};

// Asignados (sin cambios de lógica, pero usando nombres de campos correctos)
exports.asignados = async (req, res) => {
  try {
    const { choferId, fecha } = req.query;
    if (!choferId || !fecha) {
      return res.status(400).json({ error: 'choferId y fecha son requeridos' });
    }
    const start = new Date(fecha); start.setHours(0,0,0,0);
    const end   = new Date(fecha); end.setHours(23,59,59,999);

    const envios = await Envio.find({
      chofer: choferId,
      updatedAt: { $gte: start, $lte: end }
    }).select('destinatario direccion codigo_postal partido latitud longitud meli_id id_venta').lean();

    res.json(envios);
  } catch (err) {
    console.error('Error /envios/asignados:', err);
    res.status(500).json({ error: 'Error al obtener asignados' });
  }
};
