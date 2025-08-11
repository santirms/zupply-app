// backend/controllers/envioController.js
const Envio = require('../models/Envio');
// si ya tenés un servicio de geocoding, impórtalo. Si no, lo puedes implementar aquí.
const { geocodeAddress } = require('../services/geocode');  

// Crear un envío (y geolocalizarlo)
exports.crearEnvio = async (req, res) => {
  try {
    const {
      sender_id,
      cliente_id,
      id_venta,
      meli_id,
      codigo_postal,
      zona,
      partido,
      destinatario,
      direccion,
      referencia
    } = req.body;

    // 1) Geocodear la dirección completa
    const coords = await geocodeAddress(`${direccion}, ${codigo_postal} ${partido}`);
    
    // 2) Construir el documento
    const nuevo = new Envio({
      sender_id,
      cliente_id,
      id_venta,
      meli_id,
      codigo_postal,
      zona,
      partido,
      destinatario,
      direccion,
      referencia,
      lat: coords.lat,
      lng: coords.lng
    });

    // 3) Guardar en Mongo
    await nuevo.save();
    res.status(201).json(nuevo);
  } catch (err) {
    console.error('Error crearEnvio:', err);
    res.status(500).json({ error: 'Error al crear envío' });
  }
};

// Listar envíos (por ejemplo, para el panel general)
exports.listarEnvios = async (req, res) => {
  try {
    const envios = await Envio.find();
    res.json(envios);
  } catch (err) {
    console.error('Error listarEnvios:', err);
    res.status(500).json({ error: 'Error al listar envíos' });
  }
};

// Obtener por tracking_id
exports.getEnvioByTracking = async (req, res) => {
  try {
    const envio = await Envio.findOne({ tracking_id: req.params.trackingId });
    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });
    res.json(envio);
  } catch (err) {
    console.error('Error getEnvioByTracking:', err);
    res.status(500).json({ error: 'Error al buscar envío' });
  }
};

// Actualizar un envío (podés usarlo para re-geocode si cambian dirección, etc.)
exports.actualizarEnvio = async (req, res) => {
  try {
    const updates = req.body;
    // si cambió la dirección, geocodear de nuevo
    if (updates.direccion || updates.codigo_postal || updates.partido) {
      const dir = `${updates.direccion || ''}, ${updates.codigo_postal || ''} ${updates.partido || ''}`;
      const coords = await geocodeAddress(dir);
      updates.lat = coords.lat;
      updates.lng = coords.lng;
    }
    const envio = await Envio.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });
    res.json(envio);
  } catch (err) {
    console.error('Error actualizarEnvio:', err);
    res.status(500).json({ error: 'Error al actualizar envío' });
  }
};
