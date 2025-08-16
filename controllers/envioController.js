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

    // 1) buscamos el envío (por id_venta o meli_id)
    let envio = await Envio.findOne({
      $or: [{ id_venta: tracking }, { meli_id: tracking }]
    });
    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });

    // 2) si no tiene etiqueta, generarla (si usás eso)
    if (!envio.label_url) {
      const { buildLabelPDF, resolveTracking } = require('../utils/labelService');
      const QRCode = require('qrcode');
      const { url } = await buildLabelPDF(envio.toObject());
      const tk = resolveTracking(envio.toObject());
      const qr_png = await QRCode.toDataURL(tk, { width: 256, margin: 0 });
      await Envio.updateOne({ _id: envio._id }, { $set: { label_url: url, qr_png } });
    }

    // 3) devolver con cliente poblado (solo lo necesario)
    const full = await Envio.findById(envio._id)
      .populate('cliente_id', 'nombre codigo_cliente')
      .lean();

    return res.json({
      _id: full._id,
      id_venta: full.id_venta,
      meli_id: full.meli_id,
      sender_id: full.sender_id,
      cliente_id: full.cliente_id ? { _id: full.cliente_id._id, nombre: full.cliente_id.nombre } : null,
      direccion: full.direccion,
      codigo_postal: full.codigo_postal,
      partido: full.partido,
      estado: full.estado || 'pendiente',
      label_url: full.label_url || null
    });
  } catch (err) {
    console.error('getEnvioByTracking error:', err);
    res.status(500).json({ error: 'Error al buscar envío' });
  }
};

// Redirigir al PDF de etiqueta (si no existe, lo genera)
exports.labelByTracking = async (req, res) => {
  try {
    const tracking = req.params.tracking || req.params.trackingId;

    // Buscamos por id_venta (tu tracking) o meli_id
    const envio = await Envio.findOne({ id_venta: tracking }) 
               || await Envio.findOne({ meli_id: tracking });

    if (!envio) return res.status(404).send('No encontrado');

    // Si ya hay PDF generado, redirigimos
    if (envio.label_url) return res.redirect(envio.label_url);

    // Si no hay, lo generamos y redirigimos
    const { url } = await buildLabelPDF(envio.toObject());
    await Envio.updateOne({ _id: envio._id }, { $set: { label_url: url } });
    return res.redirect(url);
  } catch (e) {
    console.error('labelByTracking error:', e);
    return res.status(500).send('Error al generar/servir etiqueta');
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
