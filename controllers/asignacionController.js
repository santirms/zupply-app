const Asignacion = require('../models/Asignacion');
const Envio = require('../models/Envio');
const Chofer = require('../models/Chofer');
const { buildRemitoPDF } = require('../utils/remitoService');
const ListaDePrecios = require('../models/ListaDePrecios');

// POST /api/asignaciones/qr
// body: { chofer_id, lista_chofer_id, zona, tracking_ids: [ 'X', 'Y' ] }
exports.asignarViaQR = async (req, res) => {
  try {
    const { chofer_id, lista_chofer_id, zona, tracking_ids } = req.body;
    if (!chofer_id || !Array.isArray(tracking_ids) || !tracking_ids.length) {
      return res.status(400).json({ error: 'Faltan datos' });
      const lista = lista_chofer_id ? await ListaDePrecios.findById(lista_chofer_id).lean() : null;
      const listaNombre = lista?.nombre || ''; // ej: "Choferes Zona 1"
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

// (cuando generás el PDF)
const { url } = await buildRemitoPDF({
  asignacion: asg,
  chofer,
  envios: pendientes,
  listaNombre   // 👈 nuevo
});
await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url: url } });
    
// WhatsApp: usar listaNombre en “Zona”
const total = pendientes.length;
const tel = (chofer?.telefono || '').replace(/\D/g,'');
const texto = encodeURIComponent(
  `Hola ${chofer?.nombre || ''}! tu remito de hoy está listo:\n` +
  `📦 Total paquetes: ${total}\n` +
  `📍 Zona: ${listaNombre}\n` +              // 👈 lista de pago
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

// Listar remitos (filtros opcionales: desde, hasta, chofer_id)
exports.listarAsignaciones = async (req, res) => {
  const { desde, hasta, chofer_id } = req.query;
  const q = {};
  if (chofer_id) q.chofer = chofer_id;
  if (desde || hasta) {
    q.fecha = {};
    if (desde) q.fecha.$gte = new Date(desde);
    if (hasta) q.fecha.$lte = new Date(hasta);
  }
  const rows = await Asignacion.find(q)
    .populate('chofer', 'nombre telefono')
    .sort({ fecha: -1 })
    .select('fecha chofer zona total_paquetes remito_url')
    .lean();
  res.json(rows);
};

// Ver detalle
exports.detalleAsignacion = async (req, res) => {
  const asg = await Asignacion.findById(req.params.id).populate('chofer','nombre telefono').lean();
  if (!asg) return res.status(404).json({ error: 'No encontrada' });
  res.json(asg);
};

// Quitar envíos (volver a pendiente)
exports.quitarEnvios = async (req, res) => {
  const { tracking_ids = [] } = req.body;
  const asg = await Asignacion.findById(req.params.id);
  if (!asg) return res.status(404).json({ error: 'No encontrada' });

  const keep = [], removed = [];
  for (const it of asg.envios) {
    const trk = it.id_venta || it.meli_id;
    if (tracking_ids.includes(trk)) removed.push(it); else keep.push(it);
  }
  if (!removed.length) return res.status(400).json({ error: 'Nada para quitar' });

  asg.envios = keep;
  asg.total_paquetes = keep.length;
  await asg.save();

  // marcar envíos como pendientes
  const ids = removed.map(x => x.envio);
  await Envio.updateMany({ _id: { $in: ids } }, { $set: { estado: 'pendiente', chofer: null } });

  // regenerar PDF
  const chofer = await Chofer.findById(asg.chofer).lean();
  const { buildRemitoPDF } = require('../utils/remitoService');
  const { url } = await buildRemitoPDF({ asignacion: asg, chofer, envios: keep });
  await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url: url } });

  res.json({ ok: true, total: asg.total_paquetes, remito_url: url, quitados: removed.length });
};

// Mover envíos a otro chofer (crea nueva asignación)
exports.moverEnvios = async (req, res) => {
  const { tracking_ids = [], chofer_destino, zona } = req.body;
  const origen = await Asignacion.findById(req.params.id);
  if (!origen) return res.status(404).json({ error: 'No encontrada' });
  if (!chofer_destino || !tracking_ids.length) return res.status(400).json({ error: 'Faltan datos' });

  const mov = [], keep = [];
  for (const it of origen.envios) {
    const trk = it.id_venta || it.meli_id;
    if (tracking_ids.includes(trk)) mov.push(it); else keep.push(it);
  }
  if (!mov.length) return res.status(400).json({ error: 'Nada para mover' });

  // actualizar origen
  origen.envios = keep;
  origen.total_paquetes = keep.length;
  await origen.save();

  // nueva asignación destino
  const destino = await Asignacion.create({
    chofer: chofer_destino,
    zona: zona || origen.zona,
    envios: mov,
    total_paquetes: mov.length,
    fecha: new Date()
  });

  // actualizar estado de envíos
  await Envio.updateMany({ _id: { $in: mov.map(x=>x.envio) } }, { $set: { estado: 'asignado', chofer: chofer_destino } });

  // regenerar ambos PDFs
  const { buildRemitoPDF } = require('../utils/remitoService');
  const choferO = await Chofer.findById(origen.chofer).lean();
  const choferD = await Chofer.findById(chofer_destino).lean();
  const { url: urlO } = await buildRemitoPDF({ asignacion: origen, chofer: choferO, envios: keep });
  const { url: urlD } = await buildRemitoPDF({ asignacion: destino, chofer: choferD, envios: mov });
  await Asignacion.updateOne({ _id: origen._id }, { $set: { remito_url: urlO } });
  await Asignacion.updateOne({ _id: destino._id }, { $set: { remito_url: urlD } });

  res.json({ ok: true, origen_id: origen._id, destino_id: destino._id, remito_origen: urlO, remito_destino: urlD });
};

