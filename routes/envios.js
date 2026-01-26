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
const { generarEtiquetaInformativa } = require('../utils/labelService');
const { ensureMeliHistory: ensureMeliHistorySrv, formatSubstatus } = require('../services/meliHistory');
const logger = require('../utils/logger');
const { getFechaArgentina, getHoraArgentina, getFechaHoraArgentina } = require('../utils/timezone');
const { PDFDocument } = require('pdf-lib');
const identifyTenant = require('../middlewares/identifyTenant');  

// Configuración de AWS SDK v3 para S3
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = new S3Client({
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  },
  region: process.env.S3_REGION || 'us-east-2'
});

// Configuración de Multer para upload de archivos
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  }
});

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
router.use(identifyTenant);

// ⬇️ COORDINADOR = SOLO LECTURA EN ESTE PANEL
router.use(restrictMethodsForRoles('coordinador', ['POST','PUT','PATCH','DELETE'], {
  exceptions: [
    { path: '/manual', methods: ['POST'] },
    { path: '/guardar-masivo', methods: ['POST'] },
    { path: '/cargar-masivo', methods: ['POST'] },
    {
      path: (req) => /^\/[^/]+\/cambiar-estado$/.test(req.path),
      methods: ['PATCH']
    },
    {
      path: (req) => /^\/[^/]+\/notas$/.test(req.path),
      methods: ['POST']
    },
    {
      path: '/confirmar-entrega',
      methods: ['POST']
    },
    {
      path: '/registrar-intento-fallido',
      methods: ['POST']
    }
  ]
}));

// ——— Meli history on-demand con hora real ———
const HYDRATE_TTL_MIN = 15;  // re-hidratar si pasaron >15'

const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;  // Ventana de 7 días por defecto
const TIME_FIELD = 'fecha'; // usamos "fecha" para ventana/sort/cursor

function buildFiltroList(req) {
  const f = {};
  const { sender_id, estado, tracking, id_venta, desde, hasta, origen, chofer, incidencias } = req.query;
  const partidosRaw = req.query.partidos;
  const partidoRaw = req.query.partido;

  if (sender_id) f.sender_id = sender_id;
  if (estado)     f.estado    = estado;

  if (chofer) {
    const choferId = String(chofer).trim();
    if (choferId) {
      const conds = [];
      if (mongoose.isValidObjectId(choferId)) {
        const oid = new mongoose.Types.ObjectId(choferId);
        conds.push({ chofer: oid });
        conds.push({ chofer_id: oid });
      }
      conds.push({ chofer: choferId });
      conds.push({ chofer_id: choferId });
      conds.push({ 'chofer._id': choferId });
      const cond = conds.length > 1 ? { $or: conds } : conds[0];
      if (cond) {
        if (f.$and) f.$and.push(cond);
        else f.$and = [cond];
      }
    }
  }

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

  // Filtro por incidencias (múltiples estados + substatuses ML)
  if (incidencias === 'true') {
    f.$or = [
      // Incidencias en estado principal
      { estado: { $in: ['reprogramado', 'comprador_ausente', 'demorado', 'no_entregado', 'inaccesible', 'direccion_erronea'] } },

      // Incidencias en substatuses de ML
      { 'estado_meli.substatus': { $in: ['receiver_absent', 'not_delivered', 'to_be_agreed', 'returned_to_sender'] } },
      { 'substatus': { $in: ['receiver_absent', 'not_delivered', 'to_be_agreed', 'returned_to_sender'] } },
      { 'ml_substatus': { $in: ['receiver_absent', 'not_delivered', 'to_be_agreed', 'returned_to_sender'] } }
    ];
  } else if (estado) {
    // Mapeo de estados internos a condiciones que incluyen ML
    const estadoMap = {
      'comprador_ausente': {
        $or: [
          { estado: 'comprador_ausente' },
          { 'estado_meli.substatus': 'receiver_absent' },
          { 'substatus': 'receiver_absent' },
          { 'ml_substatus': 'receiver_absent' }
        ]
      },
      'no_entregado': {
        $or: [
          { estado: 'no_entregado' },
          { 'estado_meli.substatus': 'not_delivered' },
          { 'substatus': 'not_delivered' },
          { 'ml_substatus': 'not_delivered' }
        ]
      },
      'reprogramado': {
        $or: [
          { estado: 'reprogramado' },
          { 'estado_meli.substatus': 'to_be_agreed' },
          { 'substatus': 'to_be_agreed' },
          { 'ml_substatus': 'to_be_agreed' }
        ]
      },
      'demorado': {
        $or: [
          { estado: 'demorado' },
          { 'estado_meli.substatus': 'returned_to_sender' },
          { 'substatus': 'returned_to_sender' },
          { 'ml_substatus': 'returned_to_sender' }
        ]
      }
    };

    // Si el estado tiene mapeo especial, usarlo
    if (estadoMap[estado]) {
      Object.assign(f, estadoMap[estado]);
    } else {
      // Estados simples (pendiente, en_camino, entregado, etc)
      f.estado = estado;
    }
  }
 
  // Ventana de 7 días por defecto
  if (!desde && !hasta) {
    f[TIME_FIELD] = { $gte: new Date(Date.now() - WINDOW_7D_MS) };
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
    
   console.log('🔍 DEBUGGING DIRECCIÓN:', {
  direccion_query: req.query.direccion,
  tipo: typeof req.query.direccion,
  todos_query_params: req.query
   });
    // ---- Filtro por DIRECCIÓN (case insensitive, sin acentos) ----
    if (req.query.direccion) {
      const direccionRaw = String(req.query.direccion).trim();
      if (direccionRaw) {
        // Construir regex que ignore acentos
        // "san martin" → "s[aá]n m[aá]rt[ií]n"
        let escaped = direccionRaw
          .toLowerCase()
          .replace(/a/gi, '[aáàä]')
          .replace(/e/gi, '[eéèë]')
          .replace(/i/gi, '[iíìï]')
          .replace(/o/gi, '[oóòö]')
          .replace(/u/gi, '[uúùü]')
          .replace(/n/gi, '[nñ]');

        filtro.direccion = {
          $regex: escaped,
          $options: 'i'
        };
      }
    }

    // ---- Filtro por ORIGEN ----
    if (req.query.origen) {
      filtro.origen = req.query.origen;
    }

    // --- Cursor consistente basado en 'ts' (fecha || createdAt) ---
    // Usamos 'ts' dentro del pipeline, así soporta docs viejos que no tengan 'fecha'
    const sort = { ts: -1, _id: -1 };
    const matchFilter = { ...filtro, tenantId: req.tenantId };

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
      { $match: { ...matchFilter, ts: { $ne: null }, tenantId: req.tenantId } },

      { $sort: sort },
      { $limit: limit },
      {
        $project: {
          id_venta: 1, tracking: 1, meli_id: 1,
          estado: 1, estado_meli: 1,
          ml_status: 1, ml_substatus: 1,
          zona: 1, partido: 1,
          destinatario: 1, direccion: 1, codigo_postal: 1,
          fecha: 1, createdAt: 1, ts: 1,
          requiere_sync_meli: 1,
          origen: 1,
          cliente_id: 1, chofer: 1,
          has_notes: { $gt: [ { $size: { $ifNull: ['$notas', []] } }, 0 ] }
        }
      }
    ];

    let rows = await Envio.aggregate(pipeline);

    // populate liviano
    rows = await Cliente.populate(rows, {
      path: 'cliente_id',
      select: 'nombre razon_social codigo_cliente sender_id'
    });
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
    console.error('Error GET /envios (list):', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Error al obtener envíos' });
  }
});


// POST /guardar-masivo
router.post('/guardar-masivo', requireRole('admin','coordinador'), async (req, res) => {
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

    const docs = await Promise.all(paquetes.map(async p => {
      // Convertir campos legacy a estructura cobroEnDestino
      const cobraEnDestino = p.cobra_en_destino || false;
      const montoACobrar = cobraEnDestino ? (parseFloat(p.monto_a_cobrar) || 0) : 0;

      const zonaName = p.partido || p.zona || '';

      // Geocodificar dirección
      let coordenadas = null;
      if (p.direccion && zonaName) {  // Solo si hay dirección Y partido
        try {
          coordenadas = await geocodeDireccion({
            direccion: p.direccion,
            codigo_postal: p.codigo_postal || p.cp,
            partido: zonaName
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado: ${p.direccion}, ${zonaName} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando:', geoError.message);
        }
      } else {
        console.warn('⚠️ No se puede geocodificar: falta dirección o partido');
      }

      return {
        cliente_id:    cliente._id,
        sender_id:     cliente.codigo_cliente,
        destinatario:  p.destinatario      || '',
        direccion:     p.direccion          || '',
        piso_dpto:     p.piso_dpto          || p.pisoDpto || '',
        codigo_postal: p.codigo_postal      || p.cp || '',
        zona:          p.zona               || '',
        partido:       zonaName,
        id_venta:      p.idVenta            || p.id_venta || '',
        referencia:    p.referencia         || '',
        fecha:         getFechaArgentina(),
        precio:        p.manual_precio      ? Number(p.precio) || 0 : 0,
        estado:        'pendiente',
        requiere_sync_meli: false,
        origen:        'ingreso_manual',
        // Estructura cobroEnDestino completa
        cobroEnDestino: {
          habilitado: cobraEnDestino,
          monto: montoACobrar,
          cobrado: false,
          fechaCobro: null,
          metodoPago: null
        },
        // Campos legacy para compatibilidad
        cobra_en_destino:  cobraEnDestino,
        monto_a_cobrar:    montoACobrar > 0 ? montoACobrar : null,
        requiereFirma: p.requiereFirma || false,  // ✅ Propagar desde frontend
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: zonaName,
          cp: p.codigo_postal || p.cp || '',
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        },
         tenantId:      req.tenantId,
      };
    }));

    const inserted = await Envio.insertMany(docs);
    console.log(`guardar-masivo: insertados ${inserted.length}`);
    return res.status(201).json({ inserted: inserted.length, docs: inserted });
  } catch (err) {
    console.error('Error POST /guardar-masivo:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({ error: 'Error al guardar envíos masivos' });
  }
});

// POST /cargar-masivo
router.post('/cargar-masivo', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const etiquetas = req.body.etiquetas || req.body.envios;
    if (!Array.isArray(etiquetas) || etiquetas.length === 0) {
      return res.status(400).json({ error: 'No se recibieron etiquetas.' });
    }

    const docsPrep = await Promise.all(etiquetas.map(async et => {
      // 1) Buscamos cliente
      const cl = await Cliente.findOne({ sender_id: et.sender_id });

      // 2) Calculamos fecha combinando día/mes del PDF y año/hora actual (timezone Argentina)
      const now = getFechaArgentina();
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

      // 4) Geocodificar dirección
      let coordenadas = null;
      if (et.direccion && partido) {
        try {
          coordenadas = await geocodeDireccion({
            direccion: et.direccion,
            codigo_postal: cp,
            partido: partido
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado etiqueta: ${et.direccion}, ${partido} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando etiqueta:', geoError.message);
        }
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
        precio:        0,
        estado:        'en_planta',
        requiere_sync_meli: false,
        origen:        'etiquetas',
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: partido,
          cp: cp,
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        },
        tenantId:      req.tenantId,
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
    console.error('Error POST /cargar-masivo:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({ error: 'Error en carga masiva' });
  }
});

// POST /manual  (SOLO este bloque cambia respecto a tu versión)
router.post('/manual', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { paquetes } = req.body;
    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes.' });
    }

    const results = [];
    for (const p of paquetes) {
      const cl = await Cliente.findById(p.cliente_id).populate('lista_precios');
      if (!cl) throw new Error('Cliente no encontrado');

      // Validar permisos de firma digital
      if (p.requiereFirma && !cl.permisos?.puedeRequerirFirma) {
        throw new Error(`El cliente ${cl.nombre} no tiene permiso para solicitar firma digital`);
      }

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

      // Geocodificar dirección
      let coordenadas = null;
      if (p.direccion && zonaName) {  // Solo si hay dirección Y partido
        try {
          coordenadas = await geocodeDireccion({
            direccion: p.direccion,
            codigo_postal: p.codigo_postal,
            partido: zonaName
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado: ${p.direccion}, ${zonaName} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando:', geoError.message);
        }
      } else {
        console.warn('⚠️ No se puede geocodificar: falta dirección o partido');
      }

      // Convertir campos legacy a estructura cobroEnDestino
      const cobraEnDestino = p.cobra_en_destino || false;
      const montoACobrar = cobraEnDestino ? (parseFloat(p.monto_a_cobrar) || 0) : 0;

      const envio = await Envio.create({
        cliente_id:    cl._id,
        sender_id:     cl.codigo_cliente,
        destinatario:  p.destinatario,
        direccion:     p.direccion,
        piso_dpto:     p.piso_dpto || p.pisoDpto || '',
        codigo_postal: p.codigo_postal,
        telefono:      p.telefono || null,
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      idVenta,     // 👈 tracking del sistema
        referencia:    p.referencia,
        precio:        costo,
        fecha:         getFechaArgentina(),
        estado:        'pendiente',
        requiere_sync_meli: false,
        origen:        'ingreso_manual',
        // ===== CAMPOS NUEVOS =====
        tipo:              p.tipo || 'envio',
        contenido:         p.contenido || null,
        // Estructura cobroEnDestino completa
        cobroEnDestino: {
          habilitado: cobraEnDestino,
          monto: montoACobrar,
          cobrado: false,
          fechaCobro: null,
          metodoPago: null
        },
        // Campos legacy para compatibilidad
        cobra_en_destino:  cobraEnDestino,
        monto_a_cobrar:    montoACobrar > 0 ? montoACobrar : null,
        requiereFirma:     p.requiereFirma || false,  // ✅ Propagar desde frontend
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: zonaName,
          cp: p.codigo_postal,
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        },
        tenantId:      req.tenantId,
      });

      // Generar etiqueta 10x15 + QR usando id_venta
      console.log('=== DEBUG ETIQUETA ===');
      console.log('Cliente ID:', cl._id);
      console.log('Cliente nombre:', cl.nombre);
      console.log('Cliente razon_social:', cl.razon_social);
      console.log('Cliente completo:', JSON.stringify(cl, null, 2));

      const pdfBuffer = await generarEtiquetaInformativa(envio.toObject(), cl);

      // Subir a S3 y obtener URL
      const { ensureObject, presignGet } = require('../utils/s3');
      const s3Key = `remitos/labels/${envio.id_venta}.pdf`;
      await ensureObject(s3Key, pdfBuffer, 'application/pdf');
      const label_url = await presignGet(s3Key, 86400); // 24 horas

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
    logger.error('Error creando envío', {
    message: err.message,
    code: err.code,
    stack: err.stack?.split('\n')[0] // Solo primera línea del stack
  });
    return res.status(500).json({ error: err.message || 'Error al guardar envíos manuales' });
  }
});

// Mantener:
router.get('/tracking/:tracking', getEnvioByTracking);
router.get('/tracking/:tracking/label', labelByTracking);

// ========= GENERAR ETIQUETAS EN LOTE (PDF COMBINADO) =========
/**
 * POST /api/envios/etiquetas-lote
 * Genera UN SOLO PDF con todas las etiquetas de los envíos solicitados
 * Formatos soportados: termica (10x15cm, 1 por página), a4 (4 por hoja)
 */
router.post('/etiquetas-lote', requireAuth, async (req, res) => {
  try {
    const { envioIds, formato = 'termica' } = req.body;

    // Validaciones
    if (!Array.isArray(envioIds) || envioIds.length === 0) {
      return res.status(400).json({ error: 'Debe proporcionar al menos un ID de envío' });
    }

    if (envioIds.length > 100) {
      return res.status(400).json({ error: 'No se pueden generar más de 100 etiquetas a la vez' });
    }

    console.log(`Generando etiquetas formato ${formato} para ${envioIds.length} envíos...`);

    // Buscar todos los envíos
    const enviosValidos = [];
    for (const envioId of envioIds) {
      let envio;

      const tenantId = req.user?.tenantId || req.tenantId;
      // Intentar buscar por _id de MongoDB primero
      if (mongoose.Types.ObjectId.isValid(envioId)) {
        envio = await Envio.findById(envioId).populate('cliente_id');
      }

      // Si no se encontró, buscar por tracking/id_venta
      if (!envio) {
        envio = await Envio.findOne({
          $or: [
            { id_venta: envioId },
            { tracking: envioId },
            { meli_id: envioId }
          ]
        }).populate('cliente_id');
      }

      if (envio) {
        enviosValidos.push(envio);
      } else {
        console.warn(`Envío ${envioId} no encontrado, saltando...`);
      }
    }

    if (enviosValidos.length === 0) {
      return res.status(404).json({
        error: 'No se encontraron envíos válidos'
      });
    }

    // Generar PDF según formato
    let pdfBytes;
    if (formato === 'a4') {
      pdfBytes = await generarEtiquetasA4(enviosValidos);
    } else {
      // Formato térmico (default)
      pdfBytes = await generarEtiquetasTermicas(enviosValidos);
    }

    console.log(`✓ PDF ${formato} generado: ${enviosValidos.length} etiquetas`);

    // Enviar PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiquetas_${formato}_${Date.now()}.pdf"`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('Error generando etiquetas en lote:', err);
    res.status(500).json({
      error: 'Error generando etiquetas',
      mensaje: err.message
    });
  }
});

// Función auxiliar: generar PDF térmico (1 etiqueta por página, 10x15cm)
async function generarEtiquetasTermicas(envios) {
  // Popular cliente_id para todas las etiquetas
  for (let i = 0; i < envios.length; i++) {
    if (envios[i].cliente_id && typeof envios[i].cliente_id === 'string') {
      envios[i] = await Envio.findById(envios[i]._id)
        .populate('cliente_id', 'nombre razon_social')
        .lean();
    }
  }

  const pdfCombinado = await PDFDocument.create();

  for (const envio of envios) {
    try {
      // Generar PDF individual
      const pdfIndividual = await generarEtiquetaInformativa(envio, envio.cliente_id);

      // Cargar y copiar páginas
      const pdfDoc = await PDFDocument.load(pdfIndividual);
      const paginas = await pdfCombinado.copyPages(pdfDoc, pdfDoc.getPageIndices());
      paginas.forEach(pagina => pdfCombinado.addPage(pagina));
    } catch (err) {
      console.error(`Error procesando envío ${envio.id_venta}:`, err.message);
    }
  }

  return await pdfCombinado.save();
}

// Función auxiliar: generar PDF A4 (4 etiquetas por hoja, 2x2)
async function generarEtiquetasA4(envios) {
  // Popular cliente_id para todas las etiquetas
  for (let i = 0; i < envios.length; i++) {
    if (envios[i].cliente_id && typeof envios[i].cliente_id === 'string') {
      envios[i] = await Envio.findById(envios[i]._id)
        .populate('cliente_id', 'nombre razon_social')
        .lean();
    }
  }

  const pdfDoc = await PDFDocument.create();

  // A4 en puntos (72 puntos = 1 pulgada): 595 x 842
  const A4_WIDTH = 595;
  const A4_HEIGHT = 842;
  const MARGIN = 20;

  // 4 etiquetas por página (2 columnas x 2 filas)
  const COLS = 2;
  const ROWS = 2;
  const ETIQUETA_WIDTH = (A4_WIDTH - MARGIN * 3) / COLS;
  const ETIQUETA_HEIGHT = (A4_HEIGHT - MARGIN * 3) / ROWS;

  let paginaActual = null;
  let posicion = 0;

  for (let i = 0; i < envios.length; i++) {
    const envio = envios[i];

    try {
      // Crear nueva página cada 4 etiquetas
      if (posicion % 4 === 0) {
        paginaActual = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
        posicion = 0;
      }

      // Calcular posición en la página (origen abajo-izquierda)
      const col = posicion % COLS;
      const row = Math.floor(posicion / COLS);
      const x = MARGIN + col * (ETIQUETA_WIDTH + MARGIN);
      const y = A4_HEIGHT - MARGIN - (row + 1) * (ETIQUETA_HEIGHT + MARGIN) + MARGIN;

      // Generar etiqueta individual como PDF
      const etiquetaPdfBytes = await generarEtiquetaInformativa(envio, envio.cliente_id);
      const etiquetaDoc = await PDFDocument.load(etiquetaPdfBytes);

      // Obtener la primera página de la etiqueta
      const [etiquetaPagina] = await pdfDoc.embedPages([etiquetaDoc.getPages()[0]]);

      // Dibujar la etiqueta escalada en la posición
      paginaActual.drawPage(etiquetaPagina, {
        x,
        y,
        width: ETIQUETA_WIDTH,
        height: ETIQUETA_HEIGHT
      });

      posicion++;
    } catch (err) {
      console.error(`Error procesando envío ${envio.id_venta}:`, err.message);
    }
  }

  return await pdfDoc.save();
}

// ========= GENERAR ETIQUETAS ZPL (ZEBRA) =========
/**
 * GET /api/envios/etiquetas-zpl
 * Genera archivo ZPL para impresoras Zebra
 */
router.get('/etiquetas-zpl', requireAuth, async (req, res) => {
  try {
    const { ids } = req.query;

    if (!ids) {
      return res.status(400).json({ error: 'Parámetro ids es requerido' });
    }

    const envioIds = ids.split(',').filter(Boolean);

    if (envioIds.length === 0) {
      return res.status(400).json({ error: 'No se especificaron envíos' });
    }

    console.log(`Generando ZPL para ${envioIds.length} envíos...`);

    let zplCompleto = '';

    for (const envioId of envioIds) {
      let envio;

      // Intentar buscar por _id de MongoDB primero
      if (mongoose.Types.ObjectId.isValid(envioId)) {
        envio = await Envio.findById(envioId);
      }

      // Si no se encontró, buscar por tracking/id_venta
      if (!envio) {
        envio = await Envio.findOne({
          $or: [
            { id_venta: envioId },
            { tracking: envioId },
            { meli_id: envioId }
          ]
        });
      }

      if (envio) {
        zplCompleto += generarEtiquetaZPL(envio);
      } else {
        console.warn(`Envío ${envioId} no encontrado, saltando...`);
      }
    }

    if (!zplCompleto) {
      return res.status(404).json({ error: 'No se encontraron envíos válidos' });
    }

    console.log(`✓ ZPL generado para ${envioIds.length} envíos`);

    // Enviar como archivo de texto plano para descargar
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="etiquetas_${Date.now()}.zpl"`);
    res.send(zplCompleto);

  } catch (err) {
    console.error('Error generando ZPL:', err);
    res.status(500).json({
      error: 'Error generando archivo ZPL',
      mensaje: err.message
    });
  }
});

// Función auxiliar: generar código ZPL para una etiqueta
function generarEtiquetaZPL(envio) {
  const tracking = envio.tracking || envio.id_venta || envio.meli_id || '';
  const destinatario = (envio.destinatario || 'N/A').substring(0, 35);
  const direccion = (envio.direccion || 'N/A').substring(0, 45);
  const piso_dpto = (envio.piso_dpto || '').substring(0, 35);
  const partido = (envio.partido || 'N/A').substring(0, 25);
  const cp = envio.codigo_postal || 'N/A';
  const telefono = envio.telefono || '';
  const contenido = (envio.contenido || '').substring(0, 40);
  const referencia = (envio.referencia || '').substring(0, 40);
  const sender = envio.sender_id || 'Cliente';
  const fecha = new Date().toLocaleDateString('es-AR');

  // Determinar badge según tipo
  const tipoBadge = {
    'envio': 'E',
    'retiro': 'R',
    'cambio': 'C'
  };
  const badge = tipoBadge[envio.tipo] || 'E';

  // ZPL para etiqueta 10x15cm (4x6 pulgadas = 812x1218 dots a 203dpi)
  let zpl = `^XA
^CI28
^PW812
^LL1218

^FX === ENCABEZADO ===

^FX Badge tipo (círculo con letra)
^FO30,30^GC80,80,B^FS
^FO50,45^A0N,50,50^FR^FD${badge}^FS

^FX Datos logística
^FO130,35^A0N,28,28^FDTRANSTECH LOGISTICA^FS
^FO130,70^A0N,20,20^FDAv. Eva Peron 3777 (CP1834)^FS
^FO130,95^A0N,20,20^FDWhatsApp: +54 9 11 6445-8579^FS

^FX Línea separadora
^FO20,130^GB772,3,3^FS

^FX === CUERPO ===

^FX QR Code (izquierda)
^FO40,150
^BQN,2,5
^FDQA,${tracking}^FS

^FX ID y Fecha (derecha del QR)
^FO200,160^A0N,28,28^FDID: ${tracking}^FS
^FO200,195^A0N,22,22^FDFecha: ${fecha}^FS

^FX === DESTINATARIO ===
^FO30,290^A0N,22,22^FDDESTINATARIO^FS

^FO30,320^A0N,28,28^FD${destinatario}^FS

^FO30,360^A0N,24,24^FD${direccion}^FS

${piso_dpto ? `^FO30,390^A0N,20,20^FD${piso_dpto}^FS` : ''}

^FO30,${piso_dpto ? '420' : '395'}^A0N,24,24^FD${partido} (CP ${cp})^FS

${telefono ? `^FO30,${piso_dpto ? '455' : '430'}^A0N,22,22^FDCel: ${telefono}^FS` : ''}

${referencia ? `^FO30,${piso_dpto ? '490' : '465'}^A0N,20,20^FDRef: ${referencia}^FS` : ''}

${contenido ? `
^FO30,${piso_dpto ? '525' : '500'}^A0N,20,20^FDCONTENIDO:^FS
^FO30,${piso_dpto ? '550' : '525'}^A0N,22,22^FD${contenido}^FS
` : ''}

`;

  // Cobro en destino
  if (envio.cobroEnDestino?.habilitado && envio.cobroEnDestino?.monto) {
    const monto = envio.cobroEnDestino.monto.toLocaleString('es-AR');
    const yBase = piso_dpto ? 555 : 530;
    zpl += `
^FO30,${yBase}^A0N,32,32^FDCOBRA: $${monto}^FS
`;
  }

  // Badge especial para CAMBIO o RETIRO
  if (envio.tipo === 'cambio') {
    const yBase = piso_dpto ? 605 : 580;
    zpl += `
^FO30,${yBase}^GB752,60,3^FS
^FO50,${yBase + 15}^A0N,30,30^FD!! CAMBIO - Retirar producto !!^FS
`;
  } else if (envio.tipo === 'retiro') {
    const yBase = piso_dpto ? 605 : 580;
    zpl += `
^FO30,${yBase}^GB752,60,3^FS
^FO50,${yBase + 15}^A0N,30,30^FD!! RETIRO - Retirar producto !!^FS
`;
  }

  // Tracking grande centrado
  zpl += `
^FO30,680^A0N,50,50^FD${tracking}^FS
`;

  // Footer
  zpl += `
^FX === PIE ===

^FX Línea separadora
^FO20,980^GB772,3,3^FS

^FX Info Zupply
^FO30,1000^A0N,22,22^FDCreado con Zupply^FS
^FO30,1030^A0N,18,18^FDSoftware de ultima milla^FS
^FO30,1055^A0N,16,16^FDwww.zupply.tech | hola@zupply.tech^FS

^FX QR Linktree (derecha)
^FO650,990
^BQN,2,3
^FDQA,https://linktr.ee/zupply_tech^FS

^FO660,1100^A0N,14,14^FDContacto^FS

^FX Disclaimer
^FO30,1085^A0N,12,12^FDZupply solo provee el software,^FS
^FO30,1100^A0N,12,12^FDla operadora es responsable del servicio.^FS

^XZ
`;

  return zpl;
}

// ========= CONFIRMACIÓN DE ENTREGA CON FIRMA =========
/**
 * POST /api/envios/confirmar-entrega
 * Confirma la entrega de un envío con firma digital del destinatario
 */
router.post('/confirmar-entrega', requireAuth, upload.fields([
  { name: 'fotoDNI', maxCount: 1 },
  { name: 'firmaDigital', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      envioId,
      tipoReceptor,
      nombreReceptor,
      dniReceptor,
      aclaracionReceptor,
      geolocalizacion,
      // Cobro en destino
      confirmarCobro,
      metodoPago,
      // Legacy fields para compatibilidad
      nombreDestinatario,
      dniDestinatario
    } = req.body;

    // Parsear geolocalizacion si viene como string
    let geolocalizacionParsed = null;
    if (geolocalizacion) {
      try {
        geolocalizacionParsed = typeof geolocalizacion === 'string'
          ? JSON.parse(geolocalizacion)
          : geolocalizacion;
      } catch (e) {
        console.error('Error parseando geolocalización:', e);
      }
    }

    // Validaciones
    if (!envioId) {
      return res.status(400).json({ error: 'El ID del envío es requerido' });
    }

    // Validar DNI (nuevo o legacy)
    const dni = dniReceptor || dniDestinatario;
    if (!dni || !/^\d{7,8}$/.test(dni)) {
      return res.status(400).json({ error: 'El DNI debe tener 7-8 dígitos' });
    }

    // Validar nombre
    const nombre = nombreReceptor || nombreDestinatario;
    if (!nombre || nombre.trim().length < 3) {
      return res.status(400).json({ error: 'El nombre debe tener al menos 3 caracteres' });
    }

    // Validar tipo de receptor
    const tiposValidos = ['destinatario', 'porteria', 'familiar', 'otro'];
    const tipo = tipoReceptor || 'destinatario';
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de receptor inválido' });
    }

    // Si es "otro", requerir aclaración
    if (tipo === 'otro' && (!aclaracionReceptor || aclaracionReceptor.trim().length < 3)) {
      return res.status(400).json({ error: 'Debe aclarar la relación con el destinatario' });
    }

    // Buscar el envío
    const envio = await Envio.findById(envioId);
    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Validar cobro en destino si está habilitado
    // SOLO validar si el envío TIENE cobro habilitado y NO fue cobrado aún
    if (envio.cobroEnDestino?.habilitado === true &&
        envio.cobroEnDestino?.cobrado !== true &&
        envio.cobroEnDestino?.monto > 0) {

      if (!metodoPago || !['efectivo', 'transferencia'].includes(metodoPago)) {
        return res.status(400).json({
          error: 'Debe especificar el método de pago del cobro en destino',
          debug: {
            tieneCobroEnDestino: !!envio.cobroEnDestino,
            habilitado: envio.cobroEnDestino?.habilitado,
            monto: envio.cobroEnDestino?.monto,
            cobrado: envio.cobroEnDestino?.cobrado,
            metodoPagoRecibido: metodoPago
          }
        });
      }
    }

    // Si NO tiene cobro en destino o ya fue cobrado, continuar normalmente

    // Obtener fecha y hora en timezone de Argentina
    const { fecha: fechaEntregaArg, hora: horaEntrega } = getFechaHoraArgentina();

    // Preparar datos de confirmación
    const confirmacion = {
      confirmada: true,
      tipoReceptor: tipo,
      nombreReceptor: nombre.trim(),
      dniReceptor: dni,
      aclaracionReceptor: tipo === 'otro' ? aclaracionReceptor.trim() : null,
      fechaEntrega: fechaEntregaArg,
      horaEntrega,
      geolocalizacion: geolocalizacionParsed || null,
      // Legacy fields para compatibilidad
      nombreDestinatario: nombre.trim(),
      dniDestinatario: dni
    };

    // Si requiere firma, subirla a S3
    if (envio.requiereFirma && req.files?.firmaDigital) {
      const firmaFile = req.files.firmaDigital[0];
      const firmaKey = `envios/firmas-entrega/${envioId}_${Date.now()}.png`;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: firmaKey,
        Body: firmaFile.buffer,
        ContentType: 'image/png'
      }));

      const firmaUrl = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${firmaKey}`;
      confirmacion.firmaS3Url = firmaUrl;
      confirmacion.firmaS3Key = firmaKey;
      console.log('✓ Firma subida a S3:', firmaKey);
    }

    // Subir foto DNI a S3 (si existe)
    let fotoDNIS3Key = null;
    if (req.files?.fotoDNI) {
      const dniFile = req.files.fotoDNI[0];
      const dniKey = `dni/${envioId}_${Date.now()}.jpg`;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: dniKey,
        Body: dniFile.buffer,
        ContentType: 'image/jpeg'
      }));

      fotoDNIS3Key = dniKey;
      confirmacion.fotoDNIS3Key = dniKey;
      console.log('✓ Foto DNI subida a S3:', dniKey);
    }

    // Actualizar el envío
    envio.estado = 'entregado';
    envio.confirmacionEntrega = confirmacion;

    // SOLO actualizar cobro si el envío LO TIENE habilitado
    if (envio.cobroEnDestino?.habilitado === true && metodoPago) {
      envio.cobroEnDestino.cobrado = true;
      envio.cobroEnDestino.fechaCobro = fechaEntregaArg;
      envio.cobroEnDestino.metodoPago = metodoPago;
    }

    // Agregar al historial
    if (!envio.historial) envio.historial = [];

    // Obtener el chofer que está confirmando la entrega
    const chofer = req.user?.username || req.user?.name || req.user?.email || 'Chofer';

    let nota = `Entrega confirmada. Receptor: ${tipo}`;
    if (tipo === 'destinatario') {
      nota += ` (${nombre})`;
    } else if (tipo === 'porteria') {
      nota += ` - ${nombre}`;
    } else if (tipo === 'familiar') {
      nota += ` - ${nombre}`;
    } else if (tipo === 'otro') {
      nota += ` - ${nombre} (${aclaracionReceptor})`;
    }
    nota += `. DNI: ${dni}`;

    envio.historial.push({
      at: fechaEntregaArg,
      estado: 'entregado',
      source: 'confirmacion-entrega',
      actor_name: chofer,  // ← CHOFER que entregó (NO receptor)
      note: nota
    });

    // Agregar nota de cobro en destino si aplica
    if (envio.cobroEnDestino?.habilitado && confirmarCobro && metodoPago) {
      const montoCobrado = envio.cobroEnDestino.monto.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        style: 'currency',
        currency: 'ARS'
      });
      envio.historial.push({
        at: fechaEntregaArg,
        estado: 'entregado',
        source: 'cobro-destino',
        actor_name: chofer,
        note: `Cobro en destino confirmado: ${montoCobrado} - Método: ${metodoPago}`
      });
    }

    await envio.save();

    console.log(`✓ Entrega confirmada para envío ${envioId} - Receptor: ${tipo}`);

    res.json({
      success: true,
      envio: {
        id: envio._id,
        id_venta: envio.id_venta,
        estado: envio.estado,
        destinatario: envio.destinatario,
        confirmacionEntrega: {
          confirmada: envio.confirmacionEntrega.confirmada,
          tipoReceptor: envio.confirmacionEntrega.tipoReceptor,
          nombreReceptor: envio.confirmacionEntrega.nombreReceptor,
          dniReceptor: envio.confirmacionEntrega.dniReceptor,
          fechaEntrega: envio.confirmacionEntrega.fechaEntrega,
          horaEntrega: envio.confirmacionEntrega.horaEntrega
        }
      }
    });
  } catch (err) {
    console.error('Error confirmando entrega:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message || 'Error al confirmar entrega' });
  }
});

/**
 * GET /api/envios/:id/foto-evidencia
 * Obtiene la foto de evidencia de un intento fallido (URL firmada temporal)
 */
router.get('/:id/foto-evidencia', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ error: 'Key de S3 es requerido' });
    }

    const envio = await Envio.findById(id);
    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Verificar que la key pertenece a este envío
    let keyExiste = false;

    // Verificar en intentos fallidos
    if (envio.intentosFallidos?.some(intento => intento.fotoS3Key === key)) {
      keyExiste = true;
    }

    // Verificar en confirmación de entrega
    if (envio.confirmacionEntrega) {
      if (
        envio.confirmacionEntrega.firmaS3Key === key ||
        envio.confirmacionEntrega.fotoDNIS3Key === key ||
        envio.confirmacionEntrega.fotoChoferS3Key === key
      ) {
        keyExiste = true;
      }
    }

    if (!keyExiste) {
      return res.status(403).json({ error: 'Acceso no autorizado a esta evidencia' });
    }

    // Generar URL firmada (válida 1 hora)
    const { obtenerUrlFirmada } = require('../utils/s3');
    const urlFirmada = await obtenerUrlFirmada(key, 3600);

    res.json({ url: urlFirmada });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/envios/:envioId/firma
 * Obtiene la firma de entrega de un envío (URL firmada temporal)
 */
router.get('/:envioId/firma', requireAuth, async (req, res) => {
  try {
    const { envioId } = req.params;
    const { key } = req.query;

    // Si se proporciona una key en query, usarla directamente
    if (key) {
      // Buscar el envío
      const envio = await Envio.findById(envioId);
      if (!envio) {
        return res.status(404).json({ error: 'Envío no encontrado' });
      }

      // Verificar que la key es la firma de este envío
      if (envio.confirmacionEntrega?.firmaS3Key !== key) {
        return res.status(403).json({ error: 'Acceso no autorizado' });
      }

      // Generar URL firmada (válida 1 hora)
      const { obtenerUrlFirmada } = require('../utils/s3');
      const urlFirmada = await obtenerUrlFirmada(key, 3600);

      return res.json({ url: urlFirmada });
    }

    // Comportamiento original (sin key en query)
    // Buscar el envío
    const envio = await Envio.findById(envioId);
    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Verificar que tenga firma
    if (!envio.confirmacionEntrega?.confirmada || !envio.confirmacionEntrega?.firmaS3Key) {
      return res.status(404).json({ error: 'Este envío no tiene firma de entrega registrada' });
    }

    // Generar URL firmada temporal (válida 1 hora)
    const { obtenerUrlFirmadaFirma } = require('../utils/s3');
    const firmaUrl = await obtenerUrlFirmadaFirma(envio.confirmacionEntrega.firmaS3Key, 3600);

    res.json({
      firmaUrl,
      nombreDestinatario: envio.confirmacionEntrega.nombreDestinatario,
      dniDestinatario: envio.confirmacionEntrega.dniDestinatario,
      fechaEntrega: envio.confirmacionEntrega.fechaEntrega,
      horaEntrega: envio.confirmacionEntrega.horaEntrega,
      geolocalizacion: envio.confirmacionEntrega.geolocalizacion
    });
  } catch (err) {
    console.error('Error obteniendo firma de entrega:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message || 'Error al obtener firma' });
  }
});

/**
 * GET /api/envios/:id/foto-dni
 * Obtiene la foto del DNI de un envío (URL firmada temporal)
 */
router.get('/:id/foto-dni', requireAuth, async (req, res) => {
  try {
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ error: 'Key es requerido' });
    }

    const envio = await Envio.findById(req.params.id);

    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Verificar permisos
    const userRole = req.user.role || req.user.rol;
    if (userRole === 'cliente' && envio.cliente_id?.toString() !== req.user.cliente_id?.toString()) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    // Generar URL firmada
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({ url });

  } catch (error) {
    console.error('Error obteniendo foto DNI:', error);
    res.status(500).json({ error: error.message });
  }
});

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
    console.error('Error al obtener envíos del día:', err.message);
    console.error('Stack:', err.stack);
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
    const rawId = String(req.params.id || '').trim();
    if (!rawId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(rawId);
    const altFields = [
      'tracking', 'tracking_id', 'trackingId', 'numero_seguimiento', 'tracking_code', 'tracking_meli',
      'id_venta', 'order_id', 'venta_id', 'meli_id', 'shipment_id'
    ];
    let query = isObjectId
     ? { _id: rawId, tenantId: req.tenantId }
      : {
      $and: [
        { $or: altFields.map((field) => ({ [field]: rawId })) },
        { tenantId: req.tenantId }
        ]
      };
    let envioDoc = await Envio.findOne(query)
      .populate('cliente_id', 'nombre email razon_social sender_id')
      .populate('chofer', 'nombre telefono');

    if (!envioDoc && isObjectId) {
      query = { $or: altFields.map((field) => ({ [field]: rawId })) };
      envioDoc = await Envio.findOne(query)
        .populate('cliente_id', 'nombre email razon_social sender_id')
        .populate('chofer', 'nombre telefono');
    }

    if (!envioDoc) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const user = req.session?.user;
    if (user?.role === 'cliente') {
      const envioClienteId = envioDoc.cliente_id?._id || envioDoc.cliente_id;
      const sameCliente = envioClienteId && user.cliente_id && envioClienteId.toString() === user.cliente_id.toString();

      const envioSender = envioDoc.sender_id ?? envioDoc.senderId ?? envioDoc.sender ?? null;
      const senderIds = Array.isArray(user.sender_ids) ? user.sender_ids.map(String) : [];
      const sameSender = envioSender && senderIds.includes(String(envioSender));

      if (!sameCliente && !sameSender) {
        return res.status(403).json({ error: 'No tenés permiso para ver este envío' });
      }
    }

    // coords (puede devolver otra instancia, pero no importa)
    envioDoc = await ensureCoords(envioDoc);

    // 🔁 hidratá historial desde MeLi (usa el servicio que escribe directo en DB)
    try { await ensureMeliHistory(envioDoc); } catch (e) { console.warn('meli-history skip:', e.message); }

    // ⬅️ RE-LEER fresco desde DB (ya con historial guardado por el servicio)
    const plain = await Envio.findOne(query)
      .populate('cliente_id', 'nombre email razon_social sender_id')
      .populate('chofer', 'nombre telefono')
      .lean();

    if (Array.isArray(plain?.historial_estados)) {
      plain.historial_estados = plain.historial_estados.map(h => ({
        ...h,
        substatus_display: h.substatus_display || (h.ml_substatus ? formatSubstatus(h.ml_substatus) : null)
      }));
    }

    // timeline para el front (mergea historial+eventos)
    plain.timeline = buildTimeline(plain);
    return res.json(plain);
  } catch (err) {
    console.error('Error al obtener envío:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'Error al obtener envío' });
  }
});

// PATCH /envios/:id/geocode  (forzar desde el front)
router.patch('/:id/geocode', async (req, res) => {
  try {
    const envio = await Envio.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });
    await ensureCoords(envio);
    if (!envio.latitud || !envio.longitud) {
      return res.status(404).json({ error: 'No se pudo geocodificar' });
    }
    res.json({ ok: true, latitud: envio.latitud, longitud: envio.longitud });
  } catch (err) {
    console.error('Error PATCH geocode:', err.message);
    console.error('Stack:', err.stack);
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
          at: getFechaArgentina(),
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

    const envio = await Envio.findByIdAndUpdate({ _id: id, tenantId: req.tenantId }, id, update, { new: true });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    res.json({ ok: true, envio });
  } catch (err) {
    console.error('PATCH /envios/:id/asignar error:', err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: 'No se pudo asignar el envío' });
  }
});

// marcar entregado (solo si es propio y manual/etiqueta)
router.patch('/:id/entregar',
  requireAuth, requireRole('chofer'), onlyOwnShipments, onlyManualOrEtiqueta,
  async (req,res,next)=>{
    try {
      const fechaArg = getFechaArgentina();
      await Envio.findByIdAndUpdate(req.params.id, {
        $set: { estado:'entregado', deliveredAt: fechaArg },
        $push: { historial: { at: fechaArg, estado:'entregado', source:'chofer:panel' } }
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
        $push: { historial: { at: getFechaArgentina(), estado:'nota', source:'chofer:panel', note } }
      });
      res.json({ ok:true });
    } catch(e){ next(e); }
  }
);

// DELETE /envios/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const deleted = await Envio.findOneAndDelete({ _id: id, tenantId: req.tenantId });
    if (!deleted) return res.status(404).json({ error: 'Envío no encontrado' });
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('Error DELETE /envios/:id:', err.message);
    console.error('Stack:', err.stack);
    return res.status(500).json({ error: 'Error al eliminar envío' });
  }
});

// ========== CAMBIO DE ESTADO MANUAL ==========

/**
 * Cambiar estado de un envío manual (no sincronizado con MeLi)
 * PATCH /api/envios/:id/cambiar-estado
 */
router.patch('/:id/cambiar-estado', requireAuth, requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nuevo_estado, nota } = req.body;

    // Buscar envío
    const envio = await Envio.findOne({ _id: id, tenantId: req.tenantId });
    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Validar que sea un envío manual (NO MeLi)
    if (envio.requiere_sync_meli === true) {
      return res.status(400).json({
        error: 'Este envío se sincroniza con MercadoLibre. No se puede editar manualmente.'
      });
    }

    const nuevoEstado = String(nuevo_estado || '').trim();

    // Estados permitidos para cambio manual
    const ESTADOS_VALIDOS = [
      'pendiente',
      'en_planta',
      'en_camino',
      'comprador_ausente',
      'entregado',
      'rechazado'
    ];

    if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
      return res.status(400).json({
        error: `Estado no válido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}`
      });
    }

    // Guardar estado anterior para logging
    const estadoAnterior = envio.estado;

    // Actualizar estado
    envio.estado = nuevoEstado;

    const actor = req.user?.username || req.user?.email || 'Sistema';

    // Agregar al historial
    if (!envio.historial) envio.historial = [];
    envio.historial.push({
      at: getFechaArgentina(),
      estado: nuevoEstado,
      source: 'panel-manual',
      actor_name: actor,
      note: nota || `Cambio manual: ${estadoAnterior} → ${nuevoEstado}`
    });

    await envio.save();

    console.log(`✓ Estado de envío ${id} cambiado de "${estadoAnterior}" a "${nuevoEstado}" por ${actor}`);

    res.json({
      ok: true,
      envio,
      estado_anterior: estadoAnterior,
      estado_nuevo: nuevoEstado,
      message: `Estado actualizado a: ${nuevoEstado}`
    });
  } catch (err) {
    console.error('Error cambiando estado de envío:', err);
    res.status(500).json({ error: err.message });
  }
});

// Crear envíos en lote (cliente)
router.post(
  '/cliente/lote',
  requireAuth,
  requireRole('cliente'),
  ctrl.crearEnviosLote
);

// ========= REGISTRO DE INTENTO FALLIDO CON EVIDENCIA =========
/**
 * POST /api/envios/registrar-intento-fallido
 * Registra un intento fallido de entrega con foto de evidencia
 */
router.post('/registrar-intento-fallido', requireAuth, upload.single('fotoEvidencia'), async (req, res) => {
  try {
    console.log('=== REGISTRAR INTENTO FALLIDO ===');
    console.log('Body:', req.body);
    console.log('Tiene foto:', !!req.file);
    console.log('Usuario:', req.user?._id);

    const { envioId, motivo, descripcion, lat, lng } = req.body;

    // Validaciones
    if (!envioId) {
      return res.status(400).json({ error: 'envioId es requerido' });
    }

    if (!motivo) {
      return res.status(400).json({ error: 'motivo es requerido' });
    }

    // Motivos válidos (simplificados: ausente, inaccesible, rechazado)
    const motivosValidos = ['ausente', 'inaccesible', 'rechazado'];
    if (!motivosValidos.includes(motivo)) {
      return res.status(400).json({ error: 'Motivo de intento fallido inválido' });
    }

    // Buscar envío
    const envio = await Envio.findById(envioId);
    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    let fotoS3Url, fotoS3Key;

    // Subir foto a S3 si existe
    if (req.file) {
      try {
        console.log('Subiendo foto a S3...');

        // ✅ Usar utilidad s3.js existente
        const { subirFotoEvidencia } = require('../utils/s3');

        // Convertir buffer a base64
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        // Subir usando la función existente
        const resultado = await subirFotoEvidencia(base64Image, envioId, motivo);

        fotoS3Url = resultado.url;
        fotoS3Key = resultado.key;
        console.log('✓ Foto subida:', fotoS3Url);
      } catch (s3Error) {
        console.error('Error S3:', s3Error.message);
        // Continuar sin foto
      }
    }

    // Obtener fecha y hora en timezone de Argentina
    const { fecha: fechaIntento } = getFechaHoraArgentina();

    // Inicializar array si no existe
    if (!envio.intentosFallidos) {
      envio.intentosFallidos = [];
    }

    // Agregar intento
    envio.intentosFallidos.push({
      fecha: fechaIntento,
      motivo,
      descripcion: descripcion || '', // Opcional
      fotoS3Url,
      fotoS3Key,
      chofer: req.user._id,
      geolocalizacion: lat && lng ? {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      } : undefined
    });

    // Actualizar estado según el motivo
    const estadosMotivo = {
      'ausente': 'comprador_ausente',
      'inaccesible': 'inaccesible',
      'rechazado': 'rechazado'
    };
    envio.estado = estadosMotivo[motivo] || 'intento_fallido';

    // Agregar al historial
    if (!envio.historial) envio.historial = [];

    const chofer = req.user?.username || req.user?.name || req.user?.email || 'Chofer';

    const motivosLabel = {
      'ausente': 'Comprador ausente',
      'inaccesible': 'Dirección inaccesible',
      'rechazado': 'Rechazado'
    };

    let nota = `Intento fallido: ${motivosLabel[motivo]}`;
    if (descripcion && descripcion.trim()) {
      nota += `. ${descripcion.trim()}`;
    }
    if (fotoS3Url) {
      nota += ' (con foto de evidencia)';
    }

    envio.historial.push({
      at: fechaIntento,
      estado: estadosMotivo[motivo] || 'intento_fallido',
      source: 'intento-fallido',
      actor_name: chofer,
      note: nota
    });

    await envio.save();

    console.log('✓ Intento registrado exitosamente');

    res.json({
      success: true,
      message: 'Intento fallido registrado correctamente'
    });

  } catch (error) {
    console.error('ERROR:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      detalle: error.message
    });
  }
});

module.exports = router;
