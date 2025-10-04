// routes/envios.js
const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const Zona    = require('../models/Zona');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { geocodeDireccion } = require('../utils/geocode');
const axios   = require('axios'); 
const QRCode  = require('qrcode');
const { buildLabelPDF } = require('../utils/labelService');
const { ensureMeliHistory: ensureMeliHistorySrv } = require('../services/meliHistory');

// ⬇️ NUEVO: importo solo lo que ya tenés en el controller
const { getEnvioByTracking, labelByTracking } = require('../controllers/envioController');
const ctrl   = require('../controllers/envioController');


// ⬇️ NUEVO: middlewares
 const {
   requireAuth,
   requireRole,
   restrictMethodsForRoles,
   onlyOwnShipments,
   onlyManualOrEtiqueta
 } = require('../middlewares/auth');

// ⬇️ TODO EL PANEL GENERAL REQUIERE LOGIN
router.use(requireAuth);

// ⬇️ COORDINADOR = SOLO LECTURA EN ESTE PANEL
router.use(restrictMethodsForRoles('coordinador', ['POST','PUT','PATCH','DELETE']));

// ——— Meli history on-demand con hora real ———
const HYDRATE_TTL_MIN = 15;  // re-hidratar si pasaron >15'

const WINDOW36H_MS = 36 * 60 * 60 * 1000;
const TIME_FIELD = 'fecha'; // usamos "fecha" para ventana/sort/cursor

function buildFiltroList(req) {
  const f = {};
  const { sender_id, estado, tracking, id_venta, desde, hasta } = req.query;
  const partidosRaw = req.query.partidos;
  const partidoRaw = req.query.partido;

  if (sender_id) f.sender_id = sender_id;
  if (estado)     f.estado    = estado;

  const partidosList = [];
  if (typeof partidosRaw === 'string' && partidosRaw.trim()) {
    partidosRaw.split(',').forEach(n => {
      const nombre = n.trim();
      if (nombre) partidosList.push(nombre);
    });
  } else if (Array.isArray(partidoRaw)) {
    partidoRaw.forEach(n => {
      const nombre = String(n || '').trim();
      if (nombre) partidosList.push(nombre);
    });
  } else if (partidoRaw) {
    const nombre = String(partidoRaw).trim();
    if (nombre) partidosList.push(nombre);
  }

  if (partidosList.length === 1) {
    f.partido = partidosList[0];
  } else if (partidosList.length > 1) {
    f.partido = { $in: partidosList };
  }
  if (id_venta)   f.id_venta  = id_venta;

  // Si buscan por tracking, NO limite de fecha
  if (tracking) {
    f.$or = [{ tracking }, { id_venta: tracking }, { meli_id: tracking }];
    return f;
  }
  // 👇 Estado: mapear "reprogramado", "demorado", "comprador_ausente" a substatus MeLi
  if (estado) {
    const e = String(estado).toLowerCase();
    if (e === 'reprogramado') {
      f.$or = [
        { estado: 'reprogramado' },
        { 'estado_meli.substatus': /resched/i } // buyer_rescheduled / rescheduled
      ];
    } else if (e === 'demorado') {
      f.$or = [
        { estado: 'demorado' },
        { 'estado_meli.substatus': /delay/i }
      ];
    } else if (e === 'comprador_ausente') {
      f.$or = [
        { estado: 'comprador_ausente' },
        { 'estado_meli.substatus': /(recipient|buyer|client|addressee).*absent|not[_\s-]?at[_\s-]?home/i }
      ];
    } else {
      f.estado = e; // resto: matchea directo
    }
  }
 
  // Ventana por defecto: 36h
  if (!desde && !hasta) {
    f[TIME_FIELD] = { $gte: new Date(Date.now() - WINDOW36H_MS) };
  } else {
    const r = {};
    if (desde) r.$gte = new Date(`${desde}T00:00:00-03:00`);          // horario AR
    if (hasta) r.$lte = new Date(`${hasta}T23:59:59.999-03:00`);
    if (Object.keys(r).length) f[TIME_FIELD] = r;
  }
  return f;
}

async function getMeliAccessTokenForEnvio(envio) {
  // TODO: reemplazar por tu forma real de obtener token por cliente
  return process.env.MELI_ACCESS_TOKEN; // placeholder para probar
}

function shouldHydrate(envio) {
  if (!envio.meli_id) return false;
  const last = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;
  return !fresh || pobre;
}

function normStr(x) { return (x || '').toString().trim().toLowerCase(); }

function deriveSub(status, sub, desc) {
  const st  = normStr(status);
  let   sb  = normStr(sub);
  const msg = normStr(desc);

  // 1) si status ya es uno de los que el front quiere como "substatus", copialo
  const statusActsLikeSub = new Set([
    'ready_to_print','printed','out_for_delivery','not_visited',
    'receiver_absent','recipient_absent','buyer_absent','buyer_not_at_home',
    'addressee_not_available','client_not_at_home','recipient_not_at_home'
  ]);
  if (!sb && statusActsLikeSub.has(st)) sb = st;

  // 2) si es "not_delivered" sin sub, inferí por mensaje
  if (st === 'not_delivered' && !sb) {
    if (/absent|not\s*at\s*home|not_available|no\s*disponible|ausente/.test(msg)) {
      sb = 'recipient_absent';
    }
    if (/bad\s*address|direcci[oó]n.*err[oó]nea/.test(msg)) {
      sb = 'bad_address';
    }
    if (/not\s*visited|inaccesible|aver[ií]a/.test(msg)) {
      sb = 'not_visited';
    }
  }

  // 3) aliases/conversiones
   const aliases = {
    'buyer_not_at_home': 'recipient_absent',
    'receiver_absent': 'recipient_absent',
    'addressee_not_available': 'recipient_absent',
    'client_not_at_home': 'recipient_absent',
    'recipient_not_at_home': 'recipient_absent',
    'comprador_ausente': 'recipient_absent',
    // 👇 nuevos
    'bad address': 'bad_address',
    'not visited': 'not_visited',
    'rescheduled by meli': 'rescheduled_by_meli',
  };
  sb = aliases[sb] || sb;

  return sb; // '' si no hay nada concluyente
}

function mapMeliHistory(items = []) {
  return items.map(e => {
    const status = e.status || '';
    const sub    = deriveSub(e.status, e.substatus, e.description || e.message);

    return {
      at: new Date(e.date),
      estado: status,
      estado_meli: { status, substatus: sub }, // sub ya normalizado
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
  out.sort((a,b)=> new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0));
  return out;
}

async function ensureMeliHistory(envioDoc) {
  if (!shouldHydrate(envioDoc)) return;
  const token = await getMeliAccessTokenForEnvio(envioDoc);
  if (!token) return; // sin token, no hidratamos

  const { data } = await axios.get(
    `https://api.mercadolibre.com/shipments/${envioDoc.meli_id}/history`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const items  = Array.isArray(data) ? data : (data.results || []);
  const mapped = mapMeliHistory(items);

  envioDoc.historial = mergeHistorial(envioDoc.historial || [], mapped);
  envioDoc.meli_history_last_sync = new Date();
  await envioDoc.save();
}

// GET /envios  (LISTADO LIVIANO + 36h por defecto)
router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || '100', 10), 200);
    const filtro = buildFiltroList(req); // sigue armando condiciones por 'fecha', sender_id, estado, etc.

    // ---- Filtro por NOMBRE de cliente (y sender_id textual) ----
    if (req.query.cliente) {
      const needle = String(req.query.cliente).trim();
      if (needle) {
        const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx  = new RegExp(esc, 'i');

        const clientes = await Cliente.find({ nombre: rx }).select('_id codigo_cliente sender_id').lean();
        const ids = clientes.map(c => c._id);

        const or = [{ sender_id: rx }];
        if (ids.length) or.push({ cliente_id: { $in: ids } });

        if (filtro.$and) filtro.$and.push({ $or: or });
        else filtro.$and = [{ $or: or }];
      }
    }

    // --- Cursor consistente basado en 'ts' (fecha || createdAt) ---
    // Usamos 'ts' dentro del pipeline, así soporta docs viejos que no tengan 'fecha'
    const sort = { ts: -1, _id: -1 };
    const matchFilter = { ...filtro };

    if (req.query.cursor && !req.query.tracking) {
      const [tsIso, idStr] = String(req.query.cursor).split('|');
      const ts  = new Date(tsIso);
      const oid = new mongoose.Types.ObjectId(idStr);

      const cursorCond = {
        $or: [
          { ts: { $lt: ts } },                  // estricto menor por timestamp
          { ts: ts, _id: { $lt: oid } }         // desempate por _id
        ]
      };
      if (matchFilter.$and) matchFilter.$and.push(cursorCond);
      else matchFilter.$and = [cursorCond];
    }

    // --- Pipeline ---
    const pipeline = [
      // 'ts' unifica 'fecha' y 'createdAt'
      { $addFields: { ts: { $ifNull: ['$fecha', '$createdAt'] } } },

      // Si alguno no tiene 'ts', lo excluimos para que el cursor sea estable
      { $match: { ...matchFilter, ts: { $ne: null } } },

      { $sort: sort },
      { $limit: limit },
      {
        $project: {
          id_venta: 1, tracking: 1, meli_id: 1,
          estado: 1, estado_meli: 1,
          zona: 1, partido: 1,
          destinatario: 1, direccion: 1, codigo_postal: 1,
          fecha: 1, createdAt: 1, ts: 1,
          cliente_id: 1, chofer: 1,
          has_notes: { $gt: [ { $size: { $ifNull: ['$notas', []] } }, 0 ] }
        }
      }
    ];

    let rows = await Envio.aggregate(pipeline);

    // populate liviano
    rows = await Cliente.populate(rows, { path: 'cliente_id', select: 'nombre' });
    try {
      const Chofer = require('../models/Chofer');
      rows = await Chofer.populate(rows, { path: 'chofer', select: 'nombre' });
    } catch (_) {}

    // nextCursor basado en LA MISMA clave 'ts'
    let nextCursor = null;
    if (!req.query.tracking && rows.length) {
      const last = rows[rows.length - 1];
      if (last.ts) nextCursor = `${new Date(last.ts).toISOString()}|${last._id}`;
    }

    res.json({ rows, nextCursor });
  } catch (err) {
    console.error('Error GET /envios (list):', err);
    res.status(500).json({ error: 'Error al obtener envíos' });
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

        // 3) Derivar partido/zona desde el CP (fallback a lo que venga en la etiqueta)
  const cp = et.codigo_postal || '';
  let partido = (et.partido || '').trim();
  let zona    = (et.zona    || '').trim();

  if (!partido || !zona) {
    try {
      const z = await detectarZona(cp); // { partido, zona }
      if (!partido) partido = z?.partido || '';
      if (!zona)    zona    = z?.zona    || '';
    } catch { /* noop */ }
  }

      return {
       meli_id:       et.tracking_id      || '',
       sender_id:     et.sender_id        || '',
       cliente_id:    cl?._id             || null,
       codigo_postal: cp,
       partido,                      // 👈 ahora lo seteamos
       zona,                         // 👈 y también la zona (para facturación)
       destinatario:  et.destinatario     || '',
       direccion:     et.direccion        || '',
       referencia:    et.referencia       || '',
      fecha:         fechaEtiqueta,
      id_venta:      et.id_venta || et.order_id || et.tracking_id || '', // usa lo que tengas
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

// POST /manual  (SOLO este bloque cambia respecto a tu versión)
router.post('/manual', async (req, res) => {
  try {
    const { paquetes } = req.body;
    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes.' });
    }

    const results = [];
    for (const p of paquetes) {
      const cl = await Cliente.findById(p.cliente_id).populate('lista_precios');
      if (!cl) throw new Error('Cliente no encontrado');

      const idVenta = (p.id_venta || p.idVenta || '').trim()
        || Math.random().toString(36).substr(2,8).toUpperCase();

      const zonaName = p.zona || p.partido || '';
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

      const envio = await Envio.create({
        cliente_id:    cl._id,
        sender_id:     cl.codigo_cliente,
        destinatario:  p.destinatario,
        direccion:     p.direccion,
        codigo_postal: p.codigo_postal,
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      idVenta,     // 👈 tracking del sistema
        referencia:    p.referencia,
        precio:        costo,
        fecha:         new Date()
      });

      // Generar etiqueta 10x15 + QR usando id_venta
      const { url: label_url } = await buildLabelPDF(envio.toObject());
      const qr_png = await QRCode.toDataURL(idVenta, { width: 256, margin: 0 });
      await Envio.updateOne({ _id: envio._id }, { $set: { label_url, qr_png } });

      results.push({
        _id: envio._id.toString(),
        id_venta: idVenta,            // 👈 lo devolvemos explícito
        tracking: idVenta,            // 👈 alias por si el front espera "tracking"
        label_url,
        qr_png,
        destinatario: envio.destinatario,
        direccion: envio.direccion,
        codigo_postal: envio.codigo_postal,
        partido: envio.partido
      });
    }

    return res.status(201).json({ ok: true, total: results.length, docs: results });
  } catch (err) {
    console.error('Error POST /envios/manual:', err);
    return res.status(500).json({ error: err.message || 'Error al guardar envíos manuales' });
  }
});

// Mantener:
router.get('/tracking/:tracking', getEnvioByTracking);
router.get('/tracking/:tracking/label', labelByTracking);

// ========= NOTAS (PONER ANTES DE '/:id') =========
router.get('/:id/notas',            /*auth.requireUser,*/  ctrl.listarNotas);
router.post('/:id/notas',           /*auth.requireUser,*/  ctrl.agregarNota);
router.delete('/:id/notas/:nid',    /*auth.requireAdmin,*/ ctrl.eliminarNota);

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

// Helper: completa y guarda coords si faltan
// Geocodifica con Nominatim si faltan coords. Nunca lanza; si falla devuelve el envío como está.
async function ensureCoords(envio) {
  try {
    // Si ya tiene coords válidas, listo
    if (Number.isFinite(envio.latitud) && Number.isFinite(envio.longitud)) {
      return envio;
    }

    // Build query: dirección, partido, CP, país
    const parts = [];
    if (envio.direccion)     parts.push(envio.direccion);
    if (envio.partido)       parts.push(envio.partido);
    if (envio.codigo_postal) parts.push(envio.codigo_postal);
    parts.push('Argentina');

    const q = parts.join(', ').trim();
    if (!q) return envio; // nada para geocodificar

    // Llamada a Nominatim
    const r = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q,
        format: 'json',
        addressdetails: 1,
        limit: 1,
        countrycodes: 'ar'
      },
      headers: {
        'User-Agent': process.env.NOMINATIM_UA || 'ZupplyApp/1.0 (contact@example.com)'
      },
      timeout: 6000
    });

    const [hit] = r.data || [];
    if (!hit) return envio;

    const lat = parseFloat(hit.lat);
    const lon = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return envio;

    // Actualizamos por _id y devolvemos el documento actualizado
    const actualizado = await Envio.findByIdAndUpdate(
      envio._id,
      { $set: { latitud: lat, longitud: lon } },
      { new: true }
    );

    // Si por alguna razón no volvió doc, devolvemos el original “enriquecido”
    return actualizado || { ...(envio.toObject?.() ?? envio), latitud: lat, longitud: lon };

  } catch (e) {
    console.warn('ensureCoords: geocode falló:', e.message);
    return envio; // nunca lanzar
  }
}

// Une historial interno + eventos de MELI y los ordena
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
 if (Array.isArray(envio.notas)) {
    for (const n of envio.notas) {
      t.push({
        at: n.at || envio.fecha,
        estado: 'nota',
        estado_meli: null,
        note: n.texto || '',
        source: 'nota',
        actor_name: n.actor_name || ''   // 👈 esto alimenta la columna “Usuario”
      });
    }
  }
  t.sort((a,b) => new Date(a.at) - new Date(b.at));
  return t;
}

router.get('/mis', requireAuth, requireRole('chofer'), async (req, res, next) => {
  try {
    const choferId = req.session?.user?.driver_id;
    if (!choferId || !mongoose.isValidObjectId(choferId)) {
      return res.status(403).json({ error: 'Perfil chofer no vinculado' });
    }

    const desde = req.query.desde || req.query.from || '';
    const hasta = req.query.hasta || req.query.to   || '';

    const base = { $or: [{ chofer: choferId }, { chofer_id: choferId }] };

    if (desde || hasta) {
      const start = desde ? new Date(desde) : null;
      const end   = hasta ? new Date(`${hasta}T23:59:59.999Z`) : null;

      const inRange = f => {
        const o = {};
        if (start) o.$gte = start;
        if (end)   o.$lte = end;
        return o;
      };

      // match por updatedAt o por historial.at
      return res.json({
        ok: true,
        envios: await Envio.find({
          $and: [
            base,
            { $or: [
              { updatedAt: inRange('updatedAt') },
              { 'historial.at': inRange('historial.at') }
            ]}
          ]
        }).sort({ updatedAt: -1 }).lean()
      });
    }

    const envios = await Envio.find(base).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, envios });
  } catch (e) { next(e); }
});

// GET /envios/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    let envioDoc = await Envio.findById(id).populate('cliente_id');
    if (!envioDoc) return res.status(404).json({ error: 'Envío no encontrado' });

    // coords (puede devolver otra instancia, pero no importa)
    envioDoc = await ensureCoords(envioDoc);

    // 🔁 hidratá historial desde MeLi (usa el servicio que escribe directo en DB)
    try { await ensureMeliHistory(envioDoc); } catch (e) { console.warn('meli-history skip:', e.message); }

    // ⬅️ RE-LEER fresco desde DB (ya con historial guardado por el servicio)
    const plain = await Envio.findById(id).populate('cliente_id').lean();

    // timeline para el front (mergea historial+eventos)
    plain.timeline = buildTimeline(plain);
    return res.json(plain);
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

// PATCH /envios/:id/asignar
router.patch('/:id/asignar', async (req, res) => {
  try {
    const { id } = req.params;
    const { chofer_id, chofer_nombre, actor_name } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Opcional: si tenés modelo Chofer y querés validar el id
    let choferPayload = undefined;
    let choferName = chofer_nombre || null;
    try {
      const Chofer = require('../models/Chofer'); // si existe en tu proyecto
      if (chofer_id) {
        const ch = await Chofer.findById(chofer_id);
        if (ch) {
          choferPayload = { _id: ch._id, nombre: ch.nombre };
          choferName = ch.nombre;
        }
      }
    } catch (_) {
      // Si no tenés modelo Chofer, ignoramos y usamos sólo el nombre
    }

    // Si no resolvimos por id pero vino nombre, guardamos el nombre en un objeto simple
    if (!choferPayload && chofer_nombre) {
      choferPayload = { nombre: chofer_nombre };
    }

    const update = {
      $set: { estado: 'asignado' },
      $push: {
        historial: {
          at: new Date(),
          estado: 'asignado',
          estado_meli: null,
          source: 'zupply:asignacion',
          actor_name: actor_name || choferName || 'operador'
        }
      }
    };

    // Guardamos el chofer en el envío si tenemos algo para setear
    if (choferPayload) {
      update.$set.chofer = choferPayload;
    }

    const envio = await Envio.findByIdAndUpdate(id, update, { new: true });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    res.json({ ok: true, envio });
  } catch (err) {
    console.error('PATCH /envios/:id/asignar error:', err);
    res.status(500).json({ error: 'No se pudo asignar el envío' });
  }
});

// marcar entregado (solo si es propio y manual/etiqueta)
router.patch('/:id/entregar',
  requireAuth, requireRole('chofer'), onlyOwnShipments, onlyManualOrEtiqueta,
  async (req,res,next)=>{
    try {
      await Envio.findByIdAndUpdate(req.params.id, {
        $set: { estado:'entregado', deliveredAt: new Date() },
        $push: { historial: { at:new Date(), estado:'entregado', source:'chofer:panel' } }
      });
      res.json({ ok:true });
    } catch(e){ next(e); }
  }
);

// agregar nota (solo propio)
router.post('/:id/nota',
  requireAuth, requireRole('chofer'), onlyOwnShipments,
  async (req,res,next)=>{
    try {
      const note = String(req.body.note||'').trim();
      if (!note) return res.status(400).json({ error:'Nota vacía' });
      await Envio.findByIdAndUpdate(req.params.id, {
        $push: { historial: { at:new Date(), estado:'nota', source:'chofer:panel', note } }
      });
      res.json({ ok:true });
    } catch(e){ next(e); }
  }
);

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
