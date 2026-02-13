// backend/controllers/envioController.js
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const QRCode = require('qrcode');
const { generarEtiquetaInformativa, resolveTracking } = require('../utils/labelService');
const axios = require('axios');
const { formatSubstatus } = require('../services/meliHistory');
const logger = require('../utils/logger');
const { getFechaArgentina } = require('../utils/timezone');

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
  envio.meli_history_last_sync = getFechaArgentina();
  await envio.save();
}

// Usa tu util real; en tus otros archivos es geocodeDireccion desde ../utils/geocode
let geocodeDireccion = async () => ({ lat: null, lon: null });
try {
  ({ geocodeDireccion } = require('../utils/geocode'));
} catch (e) {
  console.warn('geocode util no disponible, sigo sin geocodificar');
}

function toNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDateOnly(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999);
  } else {
    parsed.setHours(0, 0, 0, 0);
  }
  return parsed;
}

function buildPanelClienteFechaFilter(desde, hasta) {
  const start = parseDateOnly(desde);
  const end = parseDateOnly(hasta, { endOfDay: true });

  if (!start && !end) {
    const hace2Semanas = new Date();
    hace2Semanas.setDate(hace2Semanas.getDate() - 14);
    hace2Semanas.setHours(0, 0, 0, 0);
    return { $gte: hace2Semanas };
  }

  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return range;
}

exports.obtenerShipmentsPanelCliente = async (req, res) => {
  try {
    const { page = 1, limit = 50, estado, desde, hasta } = req.query;

    const senderIdsRaw = req.user?.sender_ids || [];
    const senderIds = Array.isArray(senderIdsRaw)
      ? senderIdsRaw.filter(Boolean).map((id) => String(id))
      : typeof senderIdsRaw === 'string'
        ? [senderIdsRaw]
        : [];

    if (!senderIds.length) {
      logger.warn('[Panel Cliente] Usuario sin sender_ids', {
        user_id: req.user?._id || null
      });
      return res.json({
        envios: [],
        pagination: { page: 1, limit: Number(limit) || 50, total: 0, pages: 0 }
      });
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit, 10) || 50, 1);
    const skip = (pageNumber - 1) * limitNumber;

    const query = {
      sender_id: { $in: senderIds },
      fecha: buildPanelClienteFechaFilter(desde, hasta)
    };

    if (estado && estado !== 'todos') {
      query.estado = estado;
    }

    const [envios, total] = await Promise.all([
      Envio.find(query)
        .populate('chofer', 'nombre email')
        .populate('cliente_id', 'nombre razon_social')
        .select('id_venta tracking destinatario direccion partido codigo_postal estado estado_meli fecha meli_id sender_id cliente_id')
        .sort({ fecha: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Envio.countDocuments(query)
    ]);

    const pages = limitNumber > 0 ? Math.ceil(total / limitNumber) : 0;

    logger.info('[Panel Cliente] Envíos obtenidos', {
      sender_ids: senderIds,
      estado,
      desde,
      hasta,
      page: pageNumber,
      limit: limitNumber,
      count: envios.length,
      total
    });

    res.json({
      envios,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        pages
      },
      items: envios,
      page: pageNumber,
      limit: limitNumber,
      total,
      pages
    });
  } catch (err) {
    logger.error('[Panel Cliente] Error obteniendo envíos', err);
    res.status(500).json({ error: 'Error obteniendo envíos' });
  }
};

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
      piso_dpto,
      referencia,
      latitud: latitudOriginal,
      longitud: longitudOriginal
    } = req.body;

    // Geocode (si tenés util disponible)
    let latitud = null, longitud = null;
    const latitudInput = toNumberOrNull(latitudOriginal);
    const longitudInput = toNumberOrNull(longitudOriginal);
    const shouldGeocode = Boolean(
      direccion || codigo_postal || partido || (latitudInput !== null && longitudInput !== null)
    );
    if (shouldGeocode) {
      const coords = await geocodeDireccion({
        direccion,
        codigo_postal,
        partido,
        latitud: latitudInput ?? null,
        longitud: longitudInput ?? null
      });
      // Tus campos de esquema son latitud / longitud
      latitud  = coords?.lat ?? latitudInput ?? null;
      longitud = coords?.lon ?? coords?.lng ?? longitudInput ?? null;
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
      piso_dpto: piso_dpto || null,
      referencia,
      latitud,       // 👈 coincide con el schema
      longitud,      // 👈 coincide con el schema
      fecha: getFechaArgentina(),
      // Formato GeoJSON para el mapa
      destino: {
        partido: partido,
        cp: codigo_postal,
        loc: (latitud && longitud) ? {
          type: 'Point',
          coordinates: [longitud, latitud]  // [lon, lat] - orden GeoJSON
        } : null
      }
    });

    // Generar etiqueta 10x15 + QR usando id_venta (o meli_id)
    // Nota: generarEtiquetaInformativa devuelve Buffer, la URL se genera dinámicamente vía /api/envios/label/:tracking
    const tk = resolveTracking(nuevo);
    const qr_png = await QRCode.toDataURL(tk, { width: 256, margin: 0 });
    const label_url = `/api/envios/label/${tk}`;
    await Envio.updateOne({ _id: nuevo._id }, { $set: { label_url, qr_png } });

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
    const enriquecidos = envios.map(envio => {
      const substatus = envio.substatus || envio.ml_substatus || envio.estado_meli?.substatus || null;
      const display = envio.substatus_display || (substatus ? formatSubstatus(substatus) : null);
      return { ...envio, substatus_display: display };
    });
    res.json(enriquecidos);
  } catch (err) {
    console.error('Error listarEnvios:', err);
    res.status(500).json({ error: 'Error al listar envíos' });
  }
};

function buildTimeline(envio) {
  const NORMALIZE_ESTADO = {
    'delivered': 'entregado',
    'shipped': 'en_camino',
    'not_delivered': 'no_entregado',
    'cancelled': 'cancelado',
    'canceled': 'cancelado',
    'handling': 'en_planta',
    'ready_to_ship': 'pendiente',
    'ready_to_pick': 'listo_retiro',
    'pending': 'pendiente',
    'ingresado_por_scan': 'en_planta',
  };
  const t = [];
  if (Array.isArray(envio.historial)) {
    for (const h of envio.historial) {
      t.push({
        at: h.at || h.fecha || envio.fecha,
        estado: NORMALIZE_ESTADO[(h.estado || h.status || '').toLowerCase()] || h.estado || h.status || '',
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
        estado: NORMALIZE_ESTADO[(h.estado || h.status || h.title || '').toLowerCase()] || h.estado || h.status || h.title || '',
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

  // Safety net: si el estado actual del envío es terminal y no está en el timeline, agregarlo
  const estadoActual = NORMALIZE_ESTADO[(envio.estado || '').toLowerCase()] || envio.estado || '';
  const TERMINALES = new Set(['entregado', 'cancelado', 'no_entregado', 'rechazado_comprador']);
  if (estadoActual && TERMINALES.has(estadoActual)) {
    const yaEsta = t.some(e => e.estado === estadoActual);
    if (!yaEsta) {
      const fechaTerminal = envio.estado_meli?.updatedAt || envio.updatedAt || envio.fecha || new Date();
      t.push({
        at: fechaTerminal,
        estado: estadoActual,
        estado_meli: envio.estado_meli || null,
        descripcion: '',
        source: 'sistema',
        actor_name: 'MeLi'
      });
      t.sort((a,b) => new Date(a.at) - new Date(b.at));
    }
  }

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
    try { await ensureMeliHistorySrv(envioDoc, { rebuild: true }); } catch (e) { console.warn('meli-history skip:', e.message); }
    
    // 2) si no tiene etiqueta, generarla (si usás eso)
    if (!envio.label_url) {
      const { generarEtiquetaInformativa, resolveTracking } = require('../utils/labelService');
      const QRCode = require('qrcode');
      // Nota: generarEtiquetaInformativa devuelve Buffer, la URL se genera dinámicamente vía /api/envios/label/:tracking
      const tk = resolveTracking(envio.toObject());
      const qr_png = await QRCode.toDataURL(tk, { width: 256, margin: 0 });
      const label_url = `/api/envios/label/${tk}`;
      await Envio.updateOne({ _id: envio._id }, { $set: { label_url, qr_png } });
    }

    // 3) devolver con cliente poblado (solo lo necesario)
    const full = await Envio.findById(envio._id)
      .populate('cliente_id', 'nombre codigo_cliente')
      .lean();

    const substatus = full.substatus || full.ml_substatus || full.estado_meli?.substatus || null;
    const substatusDisplay = full.substatus_display || (substatus ? formatSubstatus(substatus) : null);

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
      substatus: substatus,
      substatus_display: substatusDisplay,
      ml_status: full.ml_status || full.estado_meli?.status || null,
      ml_substatus: full.ml_substatus || full.estado_meli?.substatus || null,
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
    const envio = await Envio.findOne({
      $or: [
        { id_venta: tracking },
        { meli_id: tracking },
        { tracking: tracking }
      ]
    }).populate('cliente_id');

    if (!envio) return res.status(404).send('Envío no encontrado');

    // Usar nueva etiqueta informativa
    const { generarEtiquetaInformativa } = require('../utils/labelService');
    const pdfBuffer = await generarEtiquetaInformativa(envio.toObject(), envio.cliente_id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${envio.id_venta}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Error generando etiqueta:', err);
    res.status(500).send('Error al generar etiqueta');
  }
};

// Actualizar (re-geocode si cambia dirección)
exports.actualizarEnvio = async (req, res) => {
  try {
    const updates = { ...req.body };
    const envioActual = await Envio.findById(req.params.id).lean();
    if (!envioActual) return res.status(404).json({ msg: 'Envío no encontrado' });

    const direccionFinal     = updates.direccion     ?? envioActual.direccion;
    const codigoPostalFinal  = updates.codigo_postal ?? envioActual.codigo_postal;
    const partidoFinal       = updates.partido       ?? envioActual.partido;
    const latitudInput       = toNumberOrNull(updates.latitud);
    const longitudInput      = toNumberOrNull(updates.longitud);
    delete updates.latitud;
    delete updates.longitud;

    const shouldGeocode = Boolean(
      updates.direccion ||
      updates.codigo_postal ||
      updates.partido ||
      latitudInput !== null && longitudInput !== null
    );

    if (shouldGeocode) {
      const coords = await geocodeDireccion({
        direccion: direccionFinal,
        codigo_postal: codigoPostalFinal,
        partido: partidoFinal,
        latitud: latitudInput ?? toNumberOrNull(envioActual.latitud),
        longitud: longitudInput ?? toNumberOrNull(envioActual.longitud)
      });
      const latitudResult  = coords?.lat ?? latitudInput ?? toNumberOrNull(envioActual.latitud);
      const longitudResult = coords?.lon ?? coords?.lng ?? longitudInput ?? toNumberOrNull(envioActual.longitud);
      updates.latitud  = latitudResult ?? null;
      updates.longitud = longitudResult ?? null;

      // Actualizar destino.loc en formato GeoJSON
      updates.destino = {
        partido: partidoFinal,
        cp: codigoPostalFinal,
        loc: (latitudResult && longitudResult) ? {
          type: 'Point',
          coordinates: [longitudResult, latitudResult]
        } : null
      };
    } else {
      if (latitudInput !== null) updates.latitud = latitudInput;
      if (longitudInput !== null) updates.longitud = longitudInput;

      // Si se actualizan coordenadas manualmente, actualizar también destino.loc
      if (latitudInput !== null || longitudInput !== null) {
        const lat = latitudInput ?? toNumberOrNull(envioActual.latitud);
        const lon = longitudInput ?? toNumberOrNull(envioActual.longitud);
        updates.destino = {
          partido: partidoFinal,
          cp: codigoPostalFinal,
          loc: (lat && lon) ? {
            type: 'Point',
            coordinates: [lon, lat]
          } : null
        };
      }
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

exports.crearEnviosLote = async (req, res) => {
  try {
    const { envios } = req.body || {};

    if (!Array.isArray(envios) || envios.length === 0) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }

    const usuario = req.user || {};
    const senderIds = Array.isArray(usuario.sender_ids)
      ? usuario.sender_ids.filter(Boolean)
      : [];

    if (senderIds.length === 0) {
      return res.status(400).json({ error: 'Usuario sin códigos asignados' });
    }

    const codigoCliente = senderIds[0];

    let clienteId = usuario?.cliente_id || null;

    if (!clienteId) {
      try {
        const cliente = await Cliente.findOne({
          $or: [
            { codigo_cliente: codigoCliente },
            { sender_id: codigoCliente }
          ]
        });

        if (!cliente) {
          return res.status(400).json({
            error: `No se encontró un cliente con código ${codigoCliente}. ` +
                   'Contacte al administrador para que lo cree en el sistema.'
          });
        }

        clienteId = cliente._id;

        const User = require('../models/User');
        await User.findByIdAndUpdate(usuario._id, {
          $set: { cliente_id: clienteId }
        });

        logger.info('[Envio Cliente] Usuario vinculado automáticamente', {
          usuario_id: usuario._id,
          email: usuario.email,
          cliente_id: clienteId,
          sender_id: codigoCliente
        });
      } catch (clienteErr) {
        logger.error('[Envio Cliente Lote] Error resolviendo cliente', {
          sender_id: codigoCliente,
          error: clienteErr.message
        });

        return res.status(500).json({ error: 'Error resolviendo cliente asociado' });
      }
    }

    // Obtener el cliente para verificar permisos
    const cliente = await Cliente.findById(clienteId);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const creados = [];
    const errores = [];

    for (let i = 0; i < envios.length; i++) {
      const data = envios[i] || {};

      try {
        if (!data.destinatario || data.destinatario.length < 3) {
          throw new Error('Destinatario inválido');
        }

        if (!data.direccion || data.direccion.length < 5) {
          throw new Error('Dirección inválida');
        }

        if (!data.codigo_postal || !/^\d{4}$/.test(data.codigo_postal)) {
          throw new Error('Código postal inválido');
        }

        // Validar tipo de envío
        if (data.tipo && !['envio', 'retiro', 'cambio'].includes(data.tipo)) {
          throw new Error('Tipo de envío inválido');
        }

        // Validar cobro en destino (soportar tanto formato nuevo como legacy)
        const cobroHabilitado = data.cobroEnDestino?.habilitado || data.cobra_en_destino || false;
        const montoCobro = data.cobroEnDestino?.monto || data.monto_a_cobrar || 0;

        if (cobroHabilitado && (!montoCobro || montoCobro <= 0)) {
          throw new Error('Debe especificar un monto válido mayor a 0 para cobro en destino');
        }

        // Validar permisos de firma digital
        const requiereFirma = data.requiereFirma || false;
        if (requiereFirma && !cliente.permisos?.puedeRequerirFirma) {
          throw new Error('Este cliente no tiene permiso para solicitar firma digital');
        }

        const idVentaRaw = data.id_venta ? String(data.id_venta).trim() : null;
        const idVenta = (idVentaRaw ? idVentaRaw.toUpperCase() : await generarIdVenta());
        const tracking = idVenta;

        const posiblesIdVenta = [{ id_venta: idVenta }];
        if (idVentaRaw && idVentaRaw !== idVenta) {
          posiblesIdVenta.push({ id_venta: idVentaRaw });
        }
        if (idVentaRaw && /^\d+$/.test(idVentaRaw)) {
          posiblesIdVenta.push({ id_venta: Number(idVentaRaw) });
        }

        const posiblesDuplicados = [
          ...posiblesIdVenta,
          { tracking }
        ];

        if (idVentaRaw && idVentaRaw !== idVenta) {
          posiblesDuplicados.push({ tracking: idVentaRaw });
        }

        if (idVentaRaw && /^\d+$/.test(idVentaRaw)) {
          posiblesDuplicados.push({ tracking: Number(idVentaRaw) });
        }

        const existe = await Envio.findOne({ $or: posiblesDuplicados });
        if (existe) {
          throw new Error(`ID de venta ${idVenta} ya existe`);
        }

        const fechaArg = getFechaArgentina();
        const nuevoEnvio = new Envio({
          sender_id: codigoCliente,
          cliente_id: clienteId,
          tenantId: req.tenantId,
          id_venta: idVenta,
          tracking,
          destinatario: data.destinatario,
          direccion: data.direccion,
          piso_dpto: data.piso_dpto || null,
          partido: data.partido,
          codigo_postal: data.codigo_postal,
          telefono: data.telefono || null,
          referencia: data.referencia || null,
          fecha: fechaArg,
          estado: 'pendiente',
          origen: 'ingreso_manual',
          requiere_sync_meli: false,
          chofer: null,
          zona: data.partido,
          tipo: data.tipo || 'envio',
          contenido: data.contenido || null,
          // Nuevo formato de cobro en destino
          cobroEnDestino: {
            habilitado: cobroHabilitado,
            monto: cobroHabilitado ? montoCobro : 0,
            cobrado: false,
            fechaCobro: null,
            metodoPago: null
          },
          // Firma digital
          requiereFirma: requiereFirma,
          // Campos legacy para compatibilidad
          cobra_en_destino: cobroHabilitado,
          monto_a_cobrar: cobroHabilitado ? montoCobro : null,
          // Formato GeoJSON para el mapa (se geocodificará después)
          destino: {
            partido: data.partido,
            cp: data.codigo_postal,
            loc: null
          },
          historial: [{
            at: fechaArg,
            estado: 'pendiente',
            source: 'cliente-web',
            actor_name: usuario.email || usuario.username || 'cliente',
            note: 'Creado desde panel de cliente'
          }]
        });

        // Geocodificar
        try {
          const coords = await geocodeDireccion({
            direccion: data.direccion,
            codigo_postal: data.codigo_postal,
            partido: data.partido
          });

          if (coords?.lat && coords?.lon) {
            nuevoEnvio.latitud = coords.lat;
            nuevoEnvio.longitud = coords.lon;
            nuevoEnvio.destino.loc = {
              type: 'Point',
              coordinates: [coords.lon, coords.lat]
            };
          }
        } catch (geoErr) {
          console.warn('Geocode error:', geoErr.message);
        }

        await nuevoEnvio.save();
        creados.push(idVenta);
      } catch (err) {
        // Log del error completo
        logger.error('[Envio Cliente Lote] Error en envío', {
          destinatario: data.destinatario,
          error: err.message,
          stack: err.stack
        });

        errores.push({
          destinatario: data.destinatario,
          error: err.message
        });
      }
    }

    logger.info('[Envio Cliente Lote] Procesados', {
      sender_id: codigoCliente,
      usuario: usuario.email,
      exitosos: creados.length,
      errores: errores.length,
      detalles_errores: errores
    });

    res.json({
      exitosos: creados.length,
      ids: creados,
      errores
    });
  } catch (err) {
    logger.error('[Envio Cliente Lote] Error:', err);
    res.status(500).json({ error: 'Error guardando envíos' });
  }
};

async function generarIdVenta() {
  const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id;
  let existe = true;

  while (existe) {
    id = '';
    for (let i = 0; i < 8; i++) {
      id += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }

    const envio = await Envio.findOne({ id_venta: id });
    existe = Boolean(envio);
  }

  return id;
}

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

    const actor_name = (req.user?.name || req.user?.nombre || req.user?.email || '—');
    const actor_role = (req.user?.role || null);
    const tipo = actor_role === 'chofer' ? 'chofer' : (actor_role === 'sistema' ? 'sistema' : 'admin');

    const fechaArg = getFechaArgentina();
    const nota = {
      texto: texto.trim(),
      usuario: actor_name,
      fecha: fechaArg,
      tipo,
      actor_name,
      actor_role
    };

    if (!Array.isArray(envio.notas)) envio.notas = [];
    envio.notas.push(nota);

    // también guardamos en historial para que aparezca con fecha/hora
    if (!Array.isArray(envio.historial)) envio.historial = [];
    envio.historial.push({
      at: fechaArg,
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

