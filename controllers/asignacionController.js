const Asignacion = require('../models/Asignacion');
const Envio = require('../models/Envio');
const Chofer = require('../models/Chofer');
const { buildRemitoPDF } = require('../utils/remitoService');

// POST /api/asignaciones/qr
// body: { chofer_id, lista_chofer_id, zona, tracking_ids: [ 'X', 'Y' ] }
exports.asignarViaQR = async (req, res) => {
  try {
    const { chofer_id, lista_chofer_id, zona, tracking_ids } = req.body;
    if (!chofer_id || !Array.isArray(tracking_ids) || !tracking_ids.length) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    // Buscar envíos por id_venta o meli_id
    const envios = await Envio.find({
      $or: [{ id_venta: { $in: tracking_ids } }, { meli_id: { $in: tracking_ids } }]
    }).populate('cliente_id').lean();

    if (!envios.length) return res.status(404).json({ error: 'No se encontraron envíos' });

    // Tomar solo pendientes
    const pendientes = envios.filter(e => (e.estado || 'pendiente') === 'pendiente');
    if (!pendientes.length) return res.status(400).json({ error: 'Todos ya estaban asignados' });

    // Crear asignación
    const asg = await Asignacion.create({
      chofer: chofer_id,
      zona,
      lista_chofer_id: lista_chofer_id || null,
      envios: pendientes.map(e => ({
        envio: e._id,
        id_venta: e.id_venta,
        meli_id: e.meli_id,
        cliente_id: e.cliente_id?._id,
        destinatario: e.destinatario,
        direccion: e.direccion,
        codigo_postal: e.codigo_postal,
        partido: e.partido,
        precio: e.precio
      })),
      total_paquetes: pendientes.length,
      fecha: new Date()
    });

    // Marcar envíos como asignados
    await Envio.updateMany(
      { _id: { $in: pendientes.map(e=>e._id) } },
      { $set: { estado:'asignado', chofer: chofer_id } }
    );

    // Generar PDF
    const chofer = await Chofer.findById(chofer_id).lean();
    const { url } = await buildRemitoPDF({ asignacion: asg, chofer, envios: pendientes });
    await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url: url } });

    // WhatsApp
    const total = pendientes.length;
    const tel = (chofer?.telefono || '').replace(/\D/g,''); // ej: 54911...
    const texto = encodeURIComponent(
      `Hola ${chofer?.nombre || ''}! tu remito de hoy está listo:\n` +
      `📦 Total paquetes: ${total}\n` +
      `📍 Zona: ${zona || ''}\n` +
      `🗓️ Fecha: ${new Date().toLocaleDateString()}\n` +
      `📄 Remito: ${url}`
    );
    const whatsapp_url = tel ? `https://wa.me/${tel}?text=${texto}` : null;

    return res.json({ ok:true, asignacion_id: asg._id, remito_url: url, whatsapp_url, total });
  } catch (err) {
    console.error('asignarViaQR error:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación' });
  }
};

// POST /api/asignaciones/mapa  (stub: mismo flujo pero recibe envio_ids)
exports.asignarViaMapa = async (req, res) => {
  try {
    const { chofer_id, lista_chofer_id, zona, envio_ids } = req.body;
    if (!chofer_id || !Array.isArray(envio_ids) || !envio_ids.length) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const envios = await Envio.find({ _id: { $in: envio_ids } }).populate('cliente_id').lean();
    req.body.tracking_ids = envios.map(e=>e.id_venta || e.meli_id).filter(Boolean);
    return exports.asignarViaQR(req, res); // reutilizamos arriba
  } catch (err) {
    console.error('asignarViaMapa error:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación' });
  }
};
