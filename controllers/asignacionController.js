const mongoose = require('mongoose');
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
try { ListaDePrecios = require('../models/ListaDePrecios'); } catch {}

const isObjId = v => mongoose.Types.ObjectId.isValid(String(v||''));

/** Resuelve un Cliente por múltiples pistas SIN castear a ObjectId cuando no corresponde */
async function resolveClienteByAny(hint) {
  if (!hint) return null;
  // si es ObjectId válido, probá por _id
  if (isObjId(hint)) {
    try { return await Cliente.findById(hint).select('nombre').lean(); } catch { /* ignore */ }
  }
  // caso string/num: buscá por campos “externos”
  const str = String(hint);
  const n = Number(str);
  const q = { $or: [
    { sender_id: str },
    ...(Number.isFinite(n) ? [{ sender_id: n }] : []),
    { meli_seller_id: str },
    { external_id: str },
  ]};
  try { return await Cliente.findOne(q).select('nombre').lean(); } catch { return null; }
}

exports.asignarViaQR = async (req, res) => {
  try {
    // -------- entrada --------
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
    const tracks = (Array.isArray(tracking_ids) && tracking_ids.length)
      ? tracking_ids.map(String)
      : [tracking, id_venta, meli_id].filter(Boolean).map(String);

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
    if (!chDoc) return res.status(400).json({ error: 'Chofer inválido' });

    // -------- buscar envíos existentes por cualquiera de las dos llaves --------
    const envios = await Envio.find({
      $or: [{ id_venta: { $in: tracks } }, { meli_id: { $in: tracks } }]
    }).populate('cliente_id').lean();

    // indexar encontrados por “cualquiera de sus llaves”
    const foundByKey = new Map();  // key → doc
    for (const e of envios) {
      if (e.id_venta) foundByKey.set(String(e.id_venta), e);
      if (e.meli_id)  foundByKey.set(String(e.meli_id),  e);
    }

    // separar internos/externos según existencia en DB (independiente del estado MeLi)
    const internos = [];
    const externosKeys = [];
    for (const t of tracks) {
      const doc = foundByKey.get(String(t));
      if (doc) internos.push(doc); else externosKeys.push(String(t));
    }

    // -------- subdocs internos (SIEMPRE se incluyen aunque su estado actual sea “en_camino”) --------
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

    // -------- externos: crear stubs respetando tu schema (sender_id/direccion/cp requeridos) --------
    const allowExternal = String(process.env.ALLOW_EXTERNAL_TRACKINGS ?? 'true').toLowerCase() === 'true';
    const subdocsExternos = [];

    if (allowExternal) {
      for (const t of externosKeys) {
        const sidRaw = senderByTrack.get(t) || sender_id_hint || null;
        const sidStr = sidRaw ? String(sidRaw) : 'externo';   // si no vino, usamos un sentinel corto
        const cli    = sidRaw ? await resolveClienteByAny(sidStr) : null;

        // stub que cumple requeridos de Envio (ajustá defaults si querés)
        const stub = await Envio.create({
          id_venta: String(t),
          meli_id: null,
          estado: 'asignado',
          source: 'externo',

          // requeridos por tu schema:
          sender_id: sidStr,
          direccion: '-',        // string no vacío
          codigo_postal: '0000', // string no vacío

          // opcionales:
          cliente_id:   cli?._id || null,
          destinatario: cli?.nombre || '',
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

    // -------- crear asignación --------
    const asg = await Asignacion.create({
      chofer: chDoc._id,
      lista_chofer_id: lista_chofer_id || null,
      lista_nombre: (lista_nombre || '').trim(),
      envios: [...subdocsInternos, ...subdocsExternos],
      total_paquetes: total,
      fecha: new Date()
    });

    // -------- marcar SOLO los internos en DB (externos ya nacen “asignado”) --------
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

    // -------- PDF (combina internos reales + externos stub) --------
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
    } catch (e) { console.error('Error al generar remito:', e); }

    // -------- WhatsApp --------
    let whatsapp_url = null;
    try {
      const tel = String(chDoc?.telefono || '').replace(/\D/g, '');
      if (tel) {
        const now = dayjs.tz(new Date(), process.env.TZ || 'America/Argentina/Buenos_Aires');
        const mensaje =
          `Hola ${chDoc?.nombre || ''}! tu remito de hoy está listo:\n` +
          `📦 Total paquetes: ${total}\n` +
          `📍 Zona: ${listaNombre || zona || ''}\n` +
          `📅 Fecha: ${now.format('DD/MM/YYYY')}\n` +
          `⌚ Hora: ${now.format('HH:mm')}`;
        whatsapp_url = `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`;
      }
    } catch {}

    return res.json({ ok:true, asignacion_id: asg._id, remito_url, whatsapp_url, total, externos: subdocsExternos.length });
  } catch (err) {
    console.error('asignarViaQR fatal:', err);
    return res.status(500).json({ error: 'No se pudo crear la asignación', detail: err.message });
  }
};
