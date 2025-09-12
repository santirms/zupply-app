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

function mapMeliHistory(items = []) {
  return items.map(e => ({
    at: new Date(e.date),                                     // ← HORA REAL
    estado: e.status,
    estado_meli: { status: e.status, substatus: e.substatus || '' },
    actor_name: 'MeLi',
    source: 'meli-history'
  }));
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

// GET /envios
router.get('/', async (req, res) => {
  try {
    const { sender_id, desde, hasta } = req.query;

    // 1) Filtro base
    const filtro = {};
    if (sender_id) filtro.sender_id = sender_id;
    if (desde || hasta) {
      filtro.fecha = {};
      if (desde) filtro.fecha.$gte = new Date(desde);
      if (hasta) filtro.fecha.$lte = new Date(hasta);
    }

    // 2) Traer envíos de DB (con cliente + lista de precios)
    const enviosDocs = await Envio.find(filtro)
      .populate({ path: 'cliente_id', populate: { path: 'lista_precios' } });

    // 3) Procesar cada envío (calcular zona de facturación, precio si falta, etc.)
    const zonaCache = new Map(); // cache partido -> nombreZona

    const envios = await Promise.all(enviosDocs.map(async (envioDoc) => {
      const e = envioDoc.toObject();

      // mantener partido tal cual
      const partidoName = e.partido || '';

      // zona de facturación: usar e.zona si viene; si no, derivar por partido
      let zonaFact = e.zona || '';
      if (!zonaFact && partidoName) {
        if (zonaCache.has(partidoName)) {
          zonaFact = zonaCache.get(partidoName);
        } else {
          const zDocByPartido = await Zona.findOne({ partidos: partidoName }, { nombre: 1 });
          zonaFact = zDocByPartido?.nombre || '';
          zonaCache.set(partidoName, zonaFact);
        }
      }

      // precio si no hay / <= 0 usando lista de precios del cliente
      if (typeof e.precio !== 'number' || e.precio <= 0) {
        let costo = 0;
        const cl = e.cliente_id;
        if (cl?.lista_precios && zonaFact) {
          const zDocByNombre = await Zona.findOne({ nombre: zonaFact }, { _id: 1 });
          if (zDocByNombre) {
            const zp = cl.lista_precios.zonas?.find(
              z => String(z.zona) === String(zDocByNombre._id)
            );
            costo = zp?.precio ?? 0;
          }
        }
        e.precio = costo;
      }

      // exponer zona (para tooltip/columna), NO tocar e.partido
      e.zona = zonaFact;

      return e;
    }));

    // 4) Responder array
    return res.json(envios);
  } catch (err) {
    console.error('Error GET /envios:', err);
    return res.status(500).json({ error: 'Error al obtener envíos' });
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
        descripcion: h.descripcion || h.message || '',
        source: h.source || 'meli',
        actor_name: h.actor_name || ''
      });
    }
  }
  t.sort((a,b) => new Date(a.at) - new Date(b.at));
  return t;
}

// GET /envios/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    let envio = await Envio.findById(id).populate('cliente_id'); // doc vivo (sin lean)


    envio = await ensureCoords(envio);   // ⬅️ usá el retorno
    // ⬇️ hidratar historial desde MeLi con HORA REAL (history.date)
    try { await ensureMeliHistory(envio); } catch (e) { console.warn('meli-history skip:', e.message); }

    const plain = envio.toObject();         // ahora sí lean
    plain.timeline = buildTimeline(plain);  // usa historial ya hidratado
    res.json(plain);
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

//front que ven los choferes

router.get('/mis', requireAuth, requireRole('chofer'), async (req, res, next) => {
  try {
    const choferId = req.session?.user?.driver_id;
   console.log('[mis] session:', req.session?.user, 'query:', req.query);
    if (!choferId || !mongoose.isValidObjectId(choferId)) {
      // si falta driver_id en sesión, devolvé 403 (no 400)
      return res.status(403).json({ error: 'Perfil chofer no vinculado' });
    }

    // acepta 'desde'/'hasta' o 'from'/'to'
    const desde = req.query.desde || req.query.from || '';
    const hasta = req.query.hasta || req.query.to || '';

    const q = {
      $or: [{ chofer: choferId }, { chofer_id: choferId }],
      // ajustá si querés limitar estados
      // estado: { $in: ['pendiente','asignado','en_ruta','entregado'] }
    };

    if (desde || hasta) {
      q.updatedAt = {};
      if (desde) q.updatedAt.$gte = new Date(desde);
      if (hasta) q.updatedAt.$lte = new Date(`${hasta}T23:59:59.999Z`);
    }

    const envios = await Envio.find(q).sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, envios });
  } catch (e) { next(e); }
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
