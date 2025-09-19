// backend/controllers/asignacionController.js
const mongoose  = require('mongoose');
const Asignacion = require('../models/Asignacion');
const Envio      = require('../models/Envio');
const Chofer     = require('../models/Chofer');
const Cliente    = require('../models/Cliente');
const { buildRemitoPDF } = require('../utils/remitoService');

const dayjs = require('dayjs');
require('dayjs/locale/es');
const utc = require('dayjs/plugin/utc');
const tz  = require('dayjs/plugin/timezone');
dayjs.extend(utc); dayjs.extend(tz); dayjs.locale('es');

let ListaDePrecios;
try { ListaDePrecios = require('../models/ListaDePrecios'); } catch (_) {}

const isObjId = v => mongoose.Types.ObjectId.isValid(String(v || ''));

/** Resolver Cliente por múltiples pistas SIN castear a ObjectId cuando no corresponde */
async function resolveClienteByAny(hint) {
  if (!hint) return null;
  if (isObjId(hint)) {
    try { return await Cliente.findById(hint).select('nombre').lean(); } catch { /* ignore */ }
  }
  const str = String(hint);
  const n   = Number(str);
  const q = {
    $or: [
      { sender_id: str },
      ...(Number.isFinite(n) ? [{ sender_id: n }] : []),
      { meli_seller_id: str },
      { external_id: str },
    ]
  };
  try { return await Cliente.findOne(q).select('nombre').lean(); } catch { return null; }
}

/* ========================================================================== */
/* 1) ASIGNAR POR QR                                                          */
/* ========================================================================== */
async function asignarViaQR(req, res) {
  try {
    const {
      chofer_id,
      chofer_nombre,
      lista_chofer_id,
      lista_nombre,
      tracking_ids,
      tracking, id_venta, meli_id,
      zona,
      sender_id_hint = null,          // pista global opcional
      items = []                      // [{ tracking, sender_id }]
    } = req.body || {};

    // -------- normalizar trackings + sender por tracking --------
    const tracksNorm = [...new Set(tracks.map(t => String(t).trim()))];
    const tracksNum  = tracksNorm
    .filter(s => /^\d+$/.test(s))                 // sólo dígitos
    .map(s => Number(s))
    .filter(n => Number.isSafeInteger(n));        // evita overflow
    
    const senderByTrack = new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const t = String(it?.tracking || '').trim();
      if (!t) continue;
      if (!tracks.includes(t)) tracks.push(t);
      const sid = String(it?.sender_id || '').trim();
      if (sid) senderByTrack.set(t, sid);
    }

    if ((!chofer_id && !chofer_nombre) || !tracks.length) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    // -------- chofer --------
    let chDoc = null;
    if (isObjId(chofer_id)) chDoc = await Chofer.findById(chofer_id).lean();
    if (!chDoc && chofer_nombre) {
      chDoc = await Chofer.findOne({ nombre: new RegExp(`^${chofer_nombre}$`, 'i') }).lean();
    }
    if (!chDoc) return res.status(400).json({ error: 'Chofer inválido (id o nombre)' });

  const envios = await Envio.find({
    // justo después del find
console.log('[asignarViaQR] tracks:', tracksNorm, 'num:', tracksNum);
console.log('[asignarViaQR] encontrados:',
  envios.map(e => ({ id_venta: e.id_venta, t: typeof e.id_venta, meli_id: e.meli_id, tm: typeof e.meli_id }))
);
  $or: [
    // id_venta puede estar almacenado como String o Number
    { id_venta: { $in: tracksNorm } },
    { id_venta: { $in: tracksNum } },

    // meli_id puede estar almacenado como String o Number (por las dudas)
    { meli_id:  { $in: tracksNorm } },
    { meli_id:  { $in: tracksNum } },
  ]
}).populate('cliente_id').lean();
   

// indexar encontrados por “cualquiera de sus llaves”
const foundByKey = new Map();
for (const e of envios) {
  if (e.id_venta != null) foundByKey.set(String(e.id_venta), e);
  if (e.meli_id  != null) foundByKey.set(String(e.meli_id),  e);
}

// separar internos/externos
const internos = [];
const externosKeys = [];
for (const t of tracksNorm) {
  const doc = foundByKey.get(String(t));
  if (doc) internos.push(doc); else externosKeys.push(String(t));
}

    // -------- internos: SIEMPRE incluir --------
    const subdocsInternos = internos.map(e => ({
      envio: e._id,
      id_venta: e.id_venta || null,
      meli_id:  e.meli_id  || null,
      cliente_id: e.cliente_id?._id || null,
      destinatario: e.destinatario || '',
      direccion: e.direccion || '',
      codigo_postal: e.codigo_postal || '',
      partido: e.partido || '',
      precio: e.precio ?? 0
    }));

    // -------- externos: crear stubs cumpliendo schema --------
    const allowExternal = String(process.env.ALLOW_EXTERNAL_TRACKINGS ?? 'true').toLowerCase() === 'true';
    const subdocsExternos = [];

    if (allowExternal) {
      for (const t of externosKeys) {
        const sidRaw = senderByTrack.get(t) || sender_id_hint || null;     // (2) cliente por sender si existe
        const sidStr = sidRaw ? String(sidRaw) : 'externo';                 // (3) sino, sentinel “externo”
        const cli    = sidRaw ? await resolveClienteByAny(sidStr) : null;

        // Stub Envio — cumple los “required” de tu schema
        const stub = await Envio.create({
          id_venta: String(t),
          meli_id: null,
          estado: 'asignado',
          source: 'externo',

          // requeridos
          sender_id: sidStr,
          direccion: '-',          // string no vacío
          codigo_postal: '0000',   // string no vacío

          // opcionales / visibles
          cliente_id:   cli?._id || null,   // si encontramos Cliente por sender
          destinatario: cli?.nombre || '',  // nombre si existe
          partido: '',
          precio: 0,

          // relación con chofer
          chofer: chDoc._id,
          chofer_nombre: chDoc.nombre
        });

        subdocsExternos.push({
          envio: stub._id,
          id_venta: stub.id_venta,
          meli_id:  null,
          cliente_id: stub.cliente_id || null,
          destinatario: stub.destinatario,
          direccion: stub.direccion,
          codigo_postal: stub.codigo_postal,
          partido: stub.partido,
          precio: stub.precio,
          externo: true
        });
      }
    }

    const total = subdocsInternos.length + subdocsExternos.length;
    if (!total) return res.status(400).json({ error: 'Nada para asignar' });

    // -------- crear Asignación --------
    const asg = await Asignacion.create({
      chofer: chDoc._id,
      lista_chofer_id: lista_chofer_id || null,
      lista_nombre: (lista_nombre || '').trim(),
      envios: [...subdocsInternos, ...subdocsExternos],
      total_paquetes: total,
      fecha: new Date()
    });

    // -------- marcar SOLO internos (externos ya nacen “asignado”) --------
    if (subdocsInternos.length) {
      const actor = req.session?.user?.email || req.session?.user?.role || 'operador';
      await Envio.updateMany(
        { _id: { $in: subdocsInternos.map(x => x.envio) } },
        {
          $set: {
            estado: 'asignado',
            chofer: chDoc._id,
            chofer_id: chDoc._id,
            chofer_nombre: chDoc.nombre
          },
          $push: {
            historial: {
              at: new Date(),
              estado: 'asignado',
              estado_meli: null,
              source: 'zupply:qr',
              actor_name: actor
            }
          },
          $currentDate: { updatedAt: true }
        }
      );
    }

    // -------- nombre de lista si vino solo el id --------
    let listaNombre = (lista_nombre || '').trim();
    if (!listaNombre && lista_chofer_id && ListaDePrecios) {
      try {
        const lp = await ListaDePrecios.findById(lista_chofer_id).lean();
        listaNombre = lp?.nombre || '';
      } catch {}
    }

    // -------- PDF (internos reales + externos stub) --------
    const enviosPDF = [
      ...internos,
      ...subdocsExternos.map(x => ({
        _id: x.envio,
        id_venta: x.id_venta,
        meli_id: null,
        cliente_id: x.cliente_id ? { _id: x.cliente_id } : null,
        destinatario: x.destinatario,
        direccion: x.direccion,
        codigo_postal: x.codigo_postal,
        partido: x.partido,
        precio: x.precio,
        sender_id: (senderByTrack.get(x.id_venta) || sender_id_hint || 'externo')
      }))
    ];

    let remito_url = null;
    try {
      const out = await buildRemitoPDF({ asignacion: asg, chofer: chDoc, envios: enviosPDF, listaNombre });
      remito_url = out?.url || null;
      if (remito_url) await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url } });
    } catch (e) {
      console.error('Error al generar remito:', e);
    }

    // -------- WhatsApp --------
    let whatsapp_url = null;
    try {
      const tel = String(chDoc?.telefono || '').replace(/\D/g, '');
      if (tel) {
        const now = dayjs.tz(new Date(), process.env.TZ || 'America/Argentina/Buenos_Aires');
        const msj =
          `Hola ${chDoc?.nombre || ''}! tu remito de hoy está listo:\n` +
          `📦 Total paquetes: ${total}\n` +
          `📍 Zona: ${listaNombre || zona || ''}\n` +
          `📅 Fecha: ${now.format('DD/MM/YYYY')}\n` +
          `⌚ Hora: ${now.format('HH:mm')}`;
        whatsapp_url = `https://wa.me/${tel}?text=${encodeURIComponent(msj)}`;
      }
    } catch {}

    return res.json({
      ok: true,
      asignacion_id: asg._id,
      remito_url,
      whatsapp_url,
      total,
      externos: subdocsExternos.length
    });
  } catch (err) {
    console.error('asignarViaQR fatal:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación', detail: err.message });
  }
}

/* ========================================================================== */
/* 2) ASIGNAR POR MAPA (reusa asignarViaQR)                                   */
/* ========================================================================== */
async function asignarViaMapa(req, res) {
  try {
    const { chofer_id, lista_chofer_id, zona, envio_ids } = req.body;
    if (!chofer_id || !Array.isArray(envio_ids) || !envio_ids.length) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const envios = await Envio.find({ _id: { $in: envio_ids } }).populate('cliente_id').lean();
    req.body.tracking_ids = envios.map(e => e.id_venta || e.meli_id).filter(Boolean);
    return asignarViaQR(req, res);
  } catch (err) {
    console.error('asignarViaMapa error:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación' });
  }
}

/* ========================================================================== */
/* 3) LISTAR ASIGNACIONES (historial)                                         */
/* ========================================================================== */
async function listarAsignaciones(req, res) {
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

    const out = rows.map(r => ({
      _id: r._id,
      fecha: r.fecha,
      chofer: r.chofer || null,
      lista_nombre: r.lista_nombre || '',
      remito_url: r.remito_url || '',
      total_paquetes: Array.isArray(r.envios) ? r.envios.length : (r.total_paquetes || 0),
    }));

    res.json(out);
  } catch (e) {
    console.error('listarAsignaciones error:', e);
    res.status(500).json({ error: 'Error al listar asignaciones' });
  }
}

/* ========================================================================== */
/* 4) DETALLE ASIGNACION                                                      */
/* ========================================================================== */
async function detalleAsignacion(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const asg = await Asignacion.findById(id)
      .populate({ path: 'chofer', select: 'nombre telefono' })
      .lean();

    if (!asg) return res.status(404).json({ error: 'Asignación no encontrada' });

    const raw = Array.isArray(asg.envios) ? asg.envios : [];
    const ids = [];
    const trackings = [];

    for (const v of raw) {
      if (!v) continue;
      const maybeId = (v && v._id) ? v._id : v;

      if (mongoose.isValidObjectId(maybeId)) {
        ids.push(maybeId);
        continue;
      }

      if (typeof v === 'object') {
        if (v.id_venta) trackings.push(String(v.id_venta).trim());
        if (v.meli_id)  trackings.push(String(v.meli_id).trim());
        if (v.tracking) trackings.push(String(v.tracking).trim());
      } else if (typeof maybeId === 'string' && maybeId.trim()) {
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
}

/* ========================================================================== */
/* 5) QUITAR ENVIOS                                                           */
/* ========================================================================== */
async function quitarEnvios(req, res) {
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

  const ids = removed.map(x => x.envio);
  await Envio.updateMany({ _id: { $in: ids } }, { $set: { estado: 'pendiente', chofer: null }, $currentDate: { updatedAt: true } });

  const chofer = await Chofer.findById(asg.chofer).lean();
  const { url } = await buildRemitoPDF({ asignacion: asg, chofer, envios: keep });
  await Asignacion.updateOne({ _id: asg._id }, { $set: { remito_url: url } });

  res.json({ ok: true, total: asg.total_paquetes, remito_url: url, quitados: removed.length });
}

/* ========================================================================== */
/* 6) MOVER ENVIOS                                                            */
/* ========================================================================== */
async function moverEnvios(req, res) {
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

  origen.envios = keep;
  origen.total_paquetes = keep.length;
  await origen.save();

  const destino = await Asignacion.create({
    chofer: chofer_destino,
    zona: zona || origen.zona,
    envios: mov,
    total_paquetes: mov.length,
    fecha: new Date()
  });

  await Envio.updateMany({ _id: { $in: mov.map(x => x.envio) } }, { $set: { estado: 'asignado', chofer: chofer_destino }, $currentDate: { updatedAt: true } });

  const choferO = await Chofer.findById(origen.chofer).lean();
  const choferD = await Chofer.findById(chofer_destino).lean();
  const { url: urlO } = await buildRemitoPDF({ asignacion: origen, chofer: choferO, envios: keep });
  const { url: urlD } = await buildRemitoPDF({ asignacion: destino, chofer: choferD, envios: mov });
  await Asignacion.updateOne({ _id: origen._id }, { $set: { remito_url: urlO } });
  await Asignacion.updateOne({ _id: destino._id }, { $set: { remito_url: urlD } });

  res.json({ ok: true, origen_id: origen._id, destino_id: destino._id, remito_origen: urlO, remito_destino: urlD });
}

/* ========================================================================== */
/* 7) AGREGAR ENVIOS A UN REMITO EXISTENTE                                    */
/* ========================================================================== */
async function agregarEnvios(req, res) {
  try {
    const asgId = req.params.id;
    const { tracking_ids = [], force_move = true, lista_chofer_id, lista_nombre, cliente_id } = req.body;
    if (!Array.isArray(tracking_ids) || !tracking_ids.length) {
      return res.status(400).json({ error: 'Sin tracking_ids' });
    }

    const asignacion = await Asignacion.findById(asgId);
    if (!asignacion) return res.status(404).json({ error: 'Asignación no encontrada' });

    const envios = await Envio.find({
      $or: [{ id_venta: { $in: tracking_ids } }, { meli_id: { $in: tracking_ids } }]
    }).populate('cliente_id').lean();

    const ya = new Set(asignacion.envios.map(e => String(e.envio)));
    const nuevos = envios.filter(e => !ya.has(String(e._id)));

    const idsNuevos = nuevos.map(e => e._id);
    const otras = await Asignacion.find({ 'envios.envio': { $in: idsNuevos } });

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

    for (const o of otras) {
      const keep = o.envios.filter(x => !idsNuevos.some(id => String(id) === String(x.envio)));
      if (keep.length !== o.envios.length) {
        o.envios = keep;
        o.total_paquetes = keep.length;
        await o.save();
        const choferO = await Chofer.findById(o.chofer).lean();
        const { url: urlO } = await buildRemitoPDF({ asignacion: o, chofer: choferO, envios: keep, listaNombre: o.lista_nombre });
        await Asignacion.updateOne({ _id: o._id }, { $set: { remito_url: urlO } });
      }
    }

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
    if (lista_nombre)     asignacion.lista_nombre   = lista_nombre;
    await asignacion.save();

    await Envio.updateMany(
      { _id: { $in: subdocs.map(x => x.envio) } },
      {
        $set: { estado: 'en_ruta', chofer: asignacion.chofer },
        $push: { eventos: { tipo:'en_ruta', origen:'sistema', detalle:`agregado a ${asignacion._id}` } },
        $currentDate: { updatedAt: true }
      }
    );

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
}

/* ========================================================================== */
/* 8) WHATSAPP LINK                                                            */
/* ========================================================================== */
async function whatsappLink(req, res) {
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
}

/* ========================================================================== */
/* 9) ELIMINAR ASIGNACION                                                     */
/* ========================================================================== */
async function eliminarAsignacion(req, res) {
  try {
    const { id } = req.params;
    const force = String(req.query.force || '').toLowerCase() === 'true';

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const asg = await Asignacion.findById(id).lean();
    if (!asg) return res.status(404).json({ error: 'Asignación no encontrada' });

    const raw = Array.isArray(asg.envios) ? asg.envios : [];
    const ids = raw
      .map(v => (v && v._id) ? v._id : v)
      .filter(x => mongoose.isValidObjectId(x));

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
}

/* ========================================================================== */

module.exports = {
  asignarViaQR,
  asignarViaMapa,
  listarAsignaciones,
  detalleAsignacion,
  quitarEnvios,
  moverEnvios,
  agregarEnvios,
  whatsappLink,
  eliminarAsignacion,
};
