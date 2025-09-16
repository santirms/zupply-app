const mongoose = require('mongoose');
const Asignacion = require('../models/Asignacion');
const Envio = require('../models/Envio');
const Chofer = require('../models/Chofer');
const Cliente = require('../models/Cliente'); // si ya lo tenés con otro nombre, ajustá
const { buildRemitoPDF } = require('../utils/remitoService');
const dayjs = require('dayjs');
require('dayjs/locale/es');
const utc = require('dayjs/plugin/utc');
const tz  = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(tz);
dayjs.locale('es');

// POST /api/asignaciones/qr
// body: { chofer_id, lista_chofer_id, zona, tracking_ids: [ 'X', 'Y' ] }
let ListaDePrecios;
try { ListaDePrecios = require('../models/ListaDePrecios'); } catch (_) {}

exports.asignarViaQR = async (req, res) => {
  try {
    // Acepta id o nombre del chofer, y distintos formatos de tracking
    const {
      chofer_id,
      chofer_nombre,
      lista_chofer_id,
      lista_nombre,
      tracking_ids,
      tracking,
      id_venta,
      meli_id,
      zona,
      cliente_id
    } = req.body || {};
     const {
    chofer_id, chofer_nombre, lista_chofer_id, lista_nombre,
    tracking_ids, tracking, id_venta, meli_id, zona,
    cliente_id,                 // legado (global)
    items                       // [{ tracking, sender_id }]
  } = req.body || {};

    // Normalizo los códigos a un array
  let tracks = (Array.isArray(tracking_ids) && tracking_ids.length)
    ? tracking_ids
    : [tracking, id_venta, meli_id].filter(Boolean);
  const senderByTrack = new Map();
  if (Array.isArray(items)) {
    for (const it of items) {
      const t = String(it?.tracking || '').trim();
      if (!t) continue;
      if (!tracks.includes(t)) tracks.push(t);
      if (it?.sender_id) senderByTrack.set(t, String(it.sender_id));
    }
   }

    if ((!chofer_id && !chofer_nombre) || !tracks.length) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    // 1) Buscar envíos por id_venta o meli_id
    const envios = await Envio.find({
      $or: [{ id_venta: { $in: tracks } }, { meli_id: { $in: tracks } }]
    }).populate('cliente_id').lean();

    if (!envios.length) {
      return res.status(404).json({ error: 'No se encontraron envíos' });
    }

    // 2) Filtrar pendientes
    const pendientes = envios.filter(e => (e.estado || 'pendiente') === 'pendiente');
    if (!pendientes.length) {
      return res.status(400).json({ error: 'Todos ya estaban asignados' });
    }

    // 3) Resolver chofer (id o nombre) y validar
    const isValidId = v => mongoose.Types.ObjectId.isValid(String(v || ''));
    let chDoc = null;
    if (isValidId(chofer_id)) {
      chDoc = await Chofer.findById(chofer_id).lean();
    }
    if (!chDoc && chofer_nombre) {
      chDoc = await Chofer.findOne({ nombre: new RegExp(`^${chofer_nombre}$`, 'i') }).lean();
    }
    if (!chDoc) {
      return res.status(400).json({ error: 'Chofer inválido (enviar chofer_id válido o chofer_nombre existente)' });
    }

     // 4) Cliente (remitente) opcional para externos
   let clienteDoc = null;
   if (cliente_id && mongoose.isValidObjectId(cliente_id)) {
     try { clienteDoc = await Cliente.findById(cliente_id).select('nombre').lean(); } catch {}
   }
    
    // 5) Crear Asignación
    const asg = await Asignacion.create({
      chofer: chDoc._id,
      lista_chofer_id: lista_chofer_id || null,
      lista_nombre: lista_nombre || '',
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
      
    const allowExternal = String(process.env.ALLOW_EXTERNAL_TRACKINGS || 'true').toLowerCase() === 'true';
    const subdocsExternos = allowExternal
     ? notFound.map(t => ({
         externo: true,
         tracking: String(t),
         id_venta: String(t),                 // para que se imprima como “tracking”
         cliente_id: clienteDoc?._id || null, // remitente si vino
         destinatario: clienteDoc?.nombre || '', // algo visible en PDF
         direccion: '',
         codigo_postal: '',
         partido: '',
         precio: 0
       }))
     : [];
         
      total_paquetes: pendientes.length,
      fecha: new Date()
    });

    // 6) Marcar envíos como asignados + chofer + historial
    const actor = req.session?.user?.email || req.session?.user?.role || 'operador';
    await Envio.updateMany(
      { _id: { $in: pendientes.map(e => e._id) } },
      {
        $set: {
          estado: 'asignado',
          chofer: chDoc._id,            // si tu esquema usa ObjectId
          chofer_id: chDoc._id,         // si además tenés un campo plano
          chofer_nombre: chDoc.nombre,  // útil para la UI
          // si TU esquema usa subdoc { chofer: { _id, nombre } }, cambia por:
          // chofer: { _id: chDoc._id, nombre: chDoc.nombre }
        },
        $push: {
          historial: {
            at: new Date(),
            estado: 'asignado',
            estado_meli: null,
            source: 'zupply:qr',
            actor_name: actor
          },
          $currentDate: { updatedAt: true }
        }
      }
    );

    // 6) Nombre visible de la lista (si no vino, lo levanto por id)
    let listaNombre = (lista_nombre || '').trim();
    if (!listaNombre && lista_chofer_id && ListaDePrecios) {
      try {
        const lp = await ListaDePrecios.findById(lista_chofer_id).lean();
        listaNombre = lp?.nombre || '';
      } catch { /* noop */ }
    }

    // 7) Generar PDF (no romper si falla)
    let remito_url = null;
    try {
      const out = await buildRemitoPDF({ asignacion: asg, chofer: chDoc, envios: enviosPDF, listaNombre });
      remito_url = out?.url || null;
      if (remito_url) {
        await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url } });
      }
    } catch (e) {
      console.error('Error al generar remito:', e);
    }

    // 8) WhatsApp (opcional)
    let whatsapp_url = null;
    try {
      const tel = String(chDoc?.telefono || '').replace(/\D/g, '');
      if (tel) {
        const now = dayjs.tz(new Date(), process.env.TZ || 'America/Argentina/Buenos_Aires');
        const mensaje =
          `Hola ${chDoc?.nombre || ''}! tu remito de hoy está listo:\n` +
          `📦 Total paquetes: ${subdocsInternos.length + subdocsExternos.length}\n` +
          `📍 Zona: ${listaNombre || zona || ''}\n` +
          `📅 Fecha: ${now.format('DD/MM/YYYY')}\n` +
          `⌚ Hora: ${now.format('HH:mm')}`;
        whatsapp_url = `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`;
      }
    } catch { /* noop */ }

    // 9) Respuesta
    return res.json({
      ok: true,
      asignacion_id: asg._id,
      remito_url,
      whatsapp_url,
      total: subdocsInternos.length + subdocsExternos.length,
      externos: subdocsExternos.length
    });
  } catch (err) {
    console.error('asignarViaQR fatal:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación', detail: err.message });
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

// Hora local AR (o lo que pongas en TZ)
const now = dayjs.tz(new Date(), process.env.TZ || 'America/Argentina/Buenos_Aires');
const fechaEs = now.format('DD/MM/YYYY');
const horaEs  = now.format('HH:mm');

// ➜ LISTAR (historial) — usa ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&chofer_id=<id>
exports.listarAsignaciones = async (req, res) => {
  try {
    const { desde, hasta, chofer_id } = req.query;
    const q = {};
    if (desde || hasta) {
      q.fecha = {};
      if (desde) q.fecha.$gte = new Date(desde);
      if (hasta) q.fecha.$lte = new Date(hasta);
    }
    if (chofer_id) q.chofer = chofer_id;

    const rows = await Asignacion.find(q)
      .populate({ path: 'chofer', select: 'nombre telefono' })
      .sort({ fecha: -1 })
      .lean();

    // Normalizamos campos que espera el front
    const out = rows.map(r => ({
      _id: r._id,
      fecha: r.fecha,
      chofer: r.chofer || null,
      // mostrar el nombre de la lista (pago chofer) como "zona"
      lista_nombre: r.lista_nombre || '',
      remito_url: r.remito_url || '',
      total_paquetes: Array.isArray(r.envios) ? r.envios.length : (r.total_paquetes || 0),
    }));

    res.json(out);
  } catch (e) {
    console.error('listarAsignaciones error:', e);
    res.status(500).json({ error: 'Error al listar asignaciones' });
  }
};

// ➜ DETALLE (para el editor)
exports.detalleAsignacion = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const asg = await Asignacion.findById(id)
      .populate({ path: 'chofer', select: 'nombre telefono' })
      .lean();

    if (!asg) return res.status(404).json({ error: 'Asignación no encontrada' });

    // Normalizo posibles formatos de "envios"
    const raw = Array.isArray(asg.envios) ? asg.envios : [];
    const ids = [];
    const trackings = [];

    for (const v of raw) {
      if (!v) continue;

      // ¿viene como ObjectId / string / objeto con _id?
      const maybeId = (v && v._id) ? v._id : v;

      if (mongoose.isValidObjectId(maybeId)) {
        ids.push(maybeId);
        continue;
      }

      // ¿viene como tracking?
      if (typeof v === 'object') {
        if (v.id_venta) trackings.push(String(v.id_venta).trim());
        if (v.meli_id)  trackings.push(String(v.meli_id).trim());
        if (v.tracking) trackings.push(String(v.tracking).trim());
      } else if (typeof maybeId === 'string' && maybeId.trim()) {
        // podría ser un tracking guardado "crudo"
        trackings.push(maybeId.trim());
      }
    }

    const found = [];

    if (ids.length) {
      const byIds = await Envio.find({ _id: { $in: ids } })
        .populate({ path: 'cliente_id', select: 'nombre' })
        .lean();
      found.push(...byIds);
    }

    if (trackings.length) {
      const byTrk = await Envio.find({
        $or: [
          { id_venta: { $in: trackings } },
          { meli_id:  { $in: trackings } }
        ]
      })
        .populate({ path: 'cliente_id', select: 'nombre' })
        .lean();

      // de-duplico por _id
      const seen = new Set(found.map(x => String(x._id)));
      for (const r of byTrk) {
        const k = String(r._id);
        if (!seen.has(k)) { found.push(r); seen.add(k); }
      }
    }

    asg.envios = found;
    asg.total_paquetes = found.length;

    return res.json(asg);
  } catch (e) {
    console.error('detalleAsignacion error:', e);
    res.status(500).json({ error: e.message || 'Error al obtener detalle' });
  }
};

// Quitar envíos (volver a pendiente)
exports.quitarEnvios = async (req, res) => {
  const { tracking_ids = [] } = req.body;
  const asg = await Asignacion.findById(req.params.id);
  if (!asg) return res.status(404).json({ error: 'No encontrada' });

  const keep = [], removed = [];
  for (const it of asg.envios) {
    const trk = it.id_venta || it.meli_id || it.tracking;
    if (tracking_ids.includes(trk)) removed.push(it); else keep.push(it);
  }
  if (!removed.length) return res.status(400).json({ error: 'Nada para quitar' });

  asg.envios = keep;
  asg.total_paquetes = keep.length;
  await asg.save();

  // marcar envíos como pendientes
  const ids = removed.map(x => x.envio);
  await Envio.updateMany({ _id: { $in: ids } }, { $set: { estado: 'pendiente', chofer: null }, $currentDate: { updatedAt: true } });


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
    const trk = it.id_venta || it.meli_id || it.tracking;
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
  await Envio.updateMany({ _id: { $in: mov.map(x=>x.envio) } }, { $set: { estado: 'asignado', chofer: chofer_destino }, $currentDate: { updatedAt: true } });

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

exports.agregarEnvios = async (req, res) => {
  try {
    const asgId = req.params.id;
    const { tracking_ids = [], force_move = true, lista_chofer_id, lista_nombre, cliente_id } = req.body;
    if (!Array.isArray(tracking_ids) || !tracking_ids.length) {
      return res.status(400).json({ error: 'Sin tracking_ids' });
    }

    const asignacion = await Asignacion.findById(asgId);
    if (!asignacion) return res.status(404).json({ error: 'Asignación no encontrada' });

    // buscar envíos por id_venta o meli_id
    const envios = await Envio.find({
      $or: [{ id_venta: { $in: tracking_ids } }, { meli_id: { $in: tracking_ids } }]
    }).populate('cliente_id').lean();


    // detectar duplicados ya presentes en este remito
    const ya = new Set(asignacion.envios.map(e => String(e.envio)));
    const nuevos = envios.filter(e => !ya.has(String(e._id)));

    // detectar envíos que están en otra asignación
    const idsNuevos = nuevos.map(e => e._id);
    const otras = await Asignacion.find({ 'envios.envio': { $in: idsNuevos } });

   // externos (trackings que no están en "envios")
   const foundSet = new Set(envios.map(e => String(e.id_venta || e.meli_id || '')));
   const externosCodes = tracking_ids.filter(t => t && !foundSet.has(String(t)));
   let clienteDoc = null;
   if (cliente_id && mongoose.isValidObjectId(cliente_id)) {
    try { clienteDoc = await require('../models/Cliente').findById(cliente_id).select('nombre').lean(); } catch {}
   }

    if (otras.length && !force_move) {
      const conflictos = [];
      for (const e of nuevos) {
        const enOtra = otras.find(o => o.envios.some(x => String(x.envio) === String(e._id)));
        if (enOtra) conflictos.push(e.id_venta || e.meli_id);
      }
      return res.status(409).json({ error: 'Algunos envíos ya están en otra asignación', conflictos });
    }

    // remover de otras asignaciones (si las hay)
    for (const o of otras) {
      const keep = o.envios.filter(x => !idsNuevos.some(id => String(id) === String(x.envio)));
      if (keep.length !== o.envios.length) {
        o.envios = keep;
        o.total_paquetes = keep.length;
        await o.save();
        // regenerar PDF de origen
        const choferO = await Chofer.findById(o.chofer).lean();
        const { url: urlO } = await buildRemitoPDF({ asignacion: o, chofer: choferO, envios: keep, listaNombre: o.lista_nombre });
        await Asignacion.updateOne({ _id: o._id }, { $set: { remito_url: urlO } });
      }
    }

    // agregar a esta asignación
    const subdocs = nuevos.map(e => ({
      envio: e._id,
      id_venta: e.id_venta,
      meli_id: e.meli_id,
      cliente_id: e.cliente_id?._id,
      destinatario: e.destinatario,
      direccion: e.direccion,
      codigo_postal: e.codigo_postal,
      partido: e.partido,
      precio: e.precio
    }));

       // subdocs externos
    const extSubdocs = externosCodes.map(t => ({
      externo: true,
      tracking: String(t),
      id_venta: String(t),
      cliente_id: clienteDoc?._id || null,
      destinatario: clienteDoc?.nombre || '',
      direccion: '',
      codigo_postal: '',
      partido: '',
      precio: 0
    }));
    
    asignacion.envios.push(...subdocs, ...extSubdocs);
    asignacion.total_paquetes = asignacion.envios.length;
    if (lista_chofer_id) asignacion.lista_chofer_id = lista_chofer_id;
    if (lista_nombre)     asignacion.lista_nombre   = lista_nombre;  // guardamos el nombre visible de la lista
    await asignacion.save();

    // actualizar envíos (estado y chofer)
    await Envio.updateMany(
      { _id: { $in: subdocs.map(x => x.envio) } },
      { 
        $set: { estado: 'en_ruta', chofer: asignacion.chofer },
        $push: { eventos: { tipo:'en_ruta', origen:'sistema', detalle:`agregado a ${asignacion._id}` } },
        $currentDate: { updatedAt: true }
      }
    );

    // regenerar PDF de destino
    const chofer = await Chofer.findById(asignacion.chofer).lean();
    const { url } = await buildRemitoPDF({ asignacion, chofer, envios: asignacion.envios, listaNombre: asignacion.lista_nombre });
    await Asignacion.updateOne({ _id: asignacion._id }, { $set: { remito_url: url } });

    return res.json({
      ok:true,
      remito_url: url,
      total: asignacion.total_paquetes,
      agregados: subdocs.length + extSubdocs.length,
      externos: extSubdocs.length
    });
    
  } catch (err) {
    console.error('agregarEnvios error:', err);
    return res.status(500).json({ error: 'No se pudo agregar' });
  }
};

exports.whatsappLink = async (req, res) => {
  try {
    const asg = await Asignacion.findById(req.params.id)
      .populate('chofer', 'nombre telefono')
      .lean();
    if (!asg) return res.status(404).json({ error: 'Asignación no encontrada' });

    const tel = (asg.chofer?.telefono || '').replace(/\D/g, '');
    const now = dayjs.tz(new Date(), process.env.TZ || 'America/Argentina/Buenos_Aires');
    const fecha = now.format('DD/MM/YYYY');
    const hora  = now.format('HH:mm');

    const tipo = String(req.query.tipo || '').toLowerCase();
    const n = Number(req.query.cantidad || 0);
    let accion = 'actualizó';
    if (tipo.includes('agreg')) accion = `se agregaron ${n} paquete${n===1?'':'s'}`;
    else if (tipo.includes('quita') || tipo.includes('remov')) accion = `se quitaron ${n} paquete${n===1?'':'s'}`;

    const msj =
      `Hola ${asg.chofer?.nombre || ''}! se actualizó tu remito de hoy:\n` +
      (accion ? `🔁 ${accion}\n` : '') +
      `📦 Total paquetes: ${asg.total_paquetes}\n` +
      `📍 Zona: ${asg.lista_nombre || asg.zona || ''}\n` +
      `📅 Fecha: ${fecha}\n` +
      `⌚ Hora: ${hora}`;

    const whatsapp_url = tel ? `https://wa.me/${tel}?text=${encodeURIComponent(msj)}` : null;
    res.json({ ok: true, whatsapp_url });
  } catch (e) {
    console.error('whatsappLink error:', e);
    res.status(500).json({ error: 'No se pudo generar el WhatsApp' });
  }
};

// DELETE /api/asignaciones/:id  (usa ?force=true para devolver envíos a pendiente)
exports.eliminarAsignacion = async (req, res) => {
  try {
    const { id } = req.params;
    const force = String(req.query.force || '').toLowerCase() === 'true';

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const asg = await Asignacion.findById(id).lean();
    if (!asg) return res.status(404).json({ error: 'Asignación no encontrada' });

    const raw = Array.isArray(asg.envios) ? asg.envios : [];
    // intentar extraer ObjectIds válidos
    const ids = raw
      .map(v => (v && v._id) ? v._id : v)
      .filter(x => mongoose.isValidObjectId(x));

    // contamos cuántos de esos IDs existen realmente
    const countExist = ids.length
      ? await Envio.countDocuments({ _id: { $in: ids } })
      : 0;

    if (countExist > 0 && !force) {
      return res.status(409).json({
        error: 'La asignación tiene envíos. Usá ?force=true para revertirlos antes de eliminar.'
      });
    }

    if (countExist > 0) {
      await Envio.updateMany(
        { _id: { $in: ids } },
        { $set: { estado: 'pendiente', chofer: null, zonaAsignada: null } }
      );
    }

    await Asignacion.deleteOne({ _id: id });
    return res.json({ ok: true, reverted: countExist });
  } catch (e) {
    console.error('eliminarAsignacion error:', e);
    res.status(500).json({ error: 'Error al eliminar asignación' });
  }
};
