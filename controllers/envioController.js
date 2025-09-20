// backend/controllers/envioController.js
const Envio = require('../models/Envio');
const QRCode = require('qrcode');
const { buildLabelPDF, resolveTracking } = require('../utils/labelService');
const axios = require('axios');

// ——— CONFIG ———
const HYDRATE_TTL_MIN = 15; // re-hidratar si pasaron > 15 min

// ⚠️ Adaptá esto a cómo obtenés el token por cliente/envío
async function getMeliAccessTokenForEnvio(envio) {
  // p.ej.: return await tokenService.getAccessToken(envio.cliente_id)
  return process.env.MELI_ACCESS_TOKEN; // placeholder para probar
}

function shouldHydrate(envio) {
  if (!envio.meli_id) return false;
  const last = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;
  return !fresh || pobre;
}

// Mapea exactamente con la HORA REAL del evento (e.date)
function mapMeliHistory(items = []) {
  return items.map(e => {
    const st  = (e.status || '').toLowerCase();
    let sub   = (e.substatus || '').toLowerCase();

    // Si ML trae estos como STATUS, copialos al substatus para que el front los muestre
    if (!sub && ['ready_to_print','printed','out_for_delivery','not_visited'].includes(st)) {
      sub = st;
    }

    return {
      at: new Date(e.date),      // hora real
      estado: e.status,
      estado_meli: { status: e.status, substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history'
    };
  });
}


function mergeHistorial(existing = [], incoming = []) {
  const key = h =>
    `${+new Date(h.at || h.updatedAt || 0)}|${(h.estado || '').toLowerCase()}|${(h.estado_meli?.substatus || '').toLowerCase()}`;
  const seen = new Set(existing.map(key));
  const out = existing.slice();
  for (const h of incoming) if (!seen.has(key(h))) out.push(h);
  out.sort((a, b) => new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0));
  return out;
}

async function ensureMeliHistory(envio) {
  if (!shouldHydrate(envio)) return;
  const token = await getMeliAccessTokenForEnvio(envio);
  if (!token) return;

  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${envio.meli_id}/history`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items = Array.isArray(data) ? data : (data.results || []);
  const mapped = mapMeliHistory(items);

  envio.historial = mergeHistorial(envio.historial || [], mapped);
  envio.meli_history_last_sync = new Date();
  await envio.save();
}

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

function buildTimeline(envio) {
  const t = [];
  if (Array.isArray(envio.historial)) {
    for (const h of envio.historial) {
      t.push({
        at: h.at || h.fecha || envio.fecha,
        estado: h.estado || h.status || '',
        estado_meli: h.estado_meli || null,         // 👈 PRESERVAR
        descripcion: h.descripcion || h.desc || '',
        source: h.source || 'sistema',
        actor_name: h.actor_name || ''
      });
    }
  }
  if (Array.isArray(envio.eventos)) {
    for (const h of envio.eventos) {
      t.push({
        at: h.at || h.date || h.fecha || envio.fecha,
        estado: h.estado || h.status || h.title || '',
        estado_meli: h.estado_meli ||                // 👈 si viene armado
                     ((h.status || h.substatus)      //    o lo armamos liviano
                       ? { status: h.status || null, substatus: h.substatus || '' }
                       : null),
        descripcion: h.descripcion || h.message || '',
        source: h.source || 'meli',
        actor_name: h.actor_name || ''
      });
    }
  }
  t.sort((a,b) => new Date(a.at) - new Date(b.at));
  return t;
}

// Buscar por tracking del sistema (id_venta) o por meli_id
exports.getEnvioByTracking = async (req, res) => {
  try {
    const tracking = req.params.tracking || req.params.trackingId;

    // 1) buscamos el envío (por id_venta o meli_id)
    let envio = await Envio.findOne({
      $or: [{ id_venta: tracking }, { meli_id: tracking }]
    });
    if (!envio) return res.status(404).json({ msg: 'Envío no encontrado' });
    
    // 👇 nuevo: traer history de MeLi y guardarlo con la hora real
    try { await ensureMeliHistory(envio); } catch (e) { console.warn('meli-history skip:', e.message); }
    
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
    
    const timeline = buildTimeline(full);
    const chofer_mostrar = full?.chofer?.nombre || full.chofer_nombre || '';
 
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
      label_url: full.label_url || null,
      chofer_mostrar,
      timeline
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

// GET /api/envios/:id/notas
exports.listarNotas = async (req, res) => {
  try {
    const envio = await Envio.findById(req.params.id).select('notas').lean();
    if (!envio) return res.status(404).json({ error: 'not found' });
    res.json(envio.notas || []);
  } catch (e) {
    res.status(500).json({ error: 'server', detail: e.message });
  }
};

// POST /api/envios/:id/notas
exports.agregarNota = async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !texto.trim()) return res.status(400).json({ error: 'texto requerido' });

    const envio = await Envio.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'not found' });

    const actor_name = (req.user?.name || req.user?.email || '—');
    const actor_role = (req.user?.role || null);

    const nota = { texto: texto.trim(), actor_name, actor_role };
    if (!Array.isArray(envio.notas)) envio.notas = [];
    envio.notas.push(nota);

    // también guardamos en historial para que aparezca con fecha/hora
    if (!Array.isArray(envio.historial)) envio.historial = [];
    envio.historial.push({
      at: new Date(),
      estado: 'nota',
      actor_name,
      note: texto.trim(),
      source: 'panel'
    });

    await envio.save();
    const creada = envio.notas[envio.notas.length - 1];
    res.json(creada);
  } catch (e) {
    res.status(500).json({ error: 'server', detail: e.message });
  }
};

// DELETE /api/envios/:id/notas/:nid
exports.eliminarNota = async (req, res) => {
  try {
    // Validación de permisos (cuando tengas auth):
    // if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    const envio = await Envio.findById(req.params.id);
    if (!envio) return res.status(404).json({ error: 'not found' });

    const sub = envio.notas?.id(req.params.nid);
    if (!sub) return res.status(404).json({ error: 'nota not found' });

    sub.deleteOne(); // quita el subdocumento
    await envio.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'server', detail: e.message });
  }
};

