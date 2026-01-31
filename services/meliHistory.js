// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');
const logger = require('../utils/logger');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(message, meta = {}) {
  if (DEBUG) {
    logger.debug(`[meli-history] ${message}`, meta);
  }
}

function sanitizeStr(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return null;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeLocation(rawLocation) {
  if (!rawLocation || typeof rawLocation !== 'object') return null;

  const lat = toNumberOrNull(pickFirst(
    rawLocation.latitude,
    rawLocation.lat,
    rawLocation.latitud,
    rawLocation.location?.latitude,
    rawLocation.coordinates?.latitude,
    rawLocation.geo?.latitude,
    rawLocation.geo?.lat
  ));

  const lng = toNumberOrNull(pickFirst(
    rawLocation.longitude,
    rawLocation.lon,
    rawLocation.longitud,
    rawLocation.location?.longitude,
    rawLocation.coordinates?.longitude,
    rawLocation.geo?.longitude,
    rawLocation.geo?.lng
  ));

  const descripcion = sanitizeStr(pickFirst(
    rawLocation.descripcion,
    rawLocation.description,
    rawLocation.address_line,
    rawLocation.address,
    rawLocation.comment,
    rawLocation.title,
    rawLocation.agency,
    rawLocation.branch,
    rawLocation.name,
    rawLocation.city?.name,
    rawLocation.city,
    rawLocation.state?.name,
    rawLocation.state_name,
    rawLocation.zip_code,
    rawLocation.reference
  ));

  const location = {};
  if (lat !== null) location.lat = lat;
  if (lng !== null) location.lng = lng;
  if (descripcion) location.descripcion = descripcion;

  return Object.keys(location).length ? location : null;
}

function metaValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    return metaValue(value.name || value.description || value.label || value.title || value.id || value.code);
  }
  return null;
}

function buildMetadataFromEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const meta = {};
  const assign = (key, value) => {
    const val = metaValue(value);
    if (val !== null && val !== undefined) {
      meta[key] = val;
    }
  };

  assign('status_code', evt.status_code);
  assign('status_category', evt.status_category);
  assign('source', evt.source || evt.origin);
  assign('shipping_mode', evt.shipping_mode);
  assign('carrier', evt.carrier || evt.logistic_type);
  assign('agency', evt.agency || evt.branch);
  assign('tracking_number', evt.tracking_number || evt.tracking_id);
  assign('checkpoint_status', evt.checkpoint_status);

  return Object.keys(meta).length ? meta : null;
}

function buildDescripcion(status, substatus, detail) {
  const detailStr = sanitizeStr(detail);
  if (detailStr) return detailStr;
  const statusStr = sanitizeStr(status);
  const subStr = sanitizeStr(substatus);
  if (statusStr && subStr) return `${statusStr} · ${subStr}`;
  return statusStr || subStr || null;
}

function formatSubstatus(substatus) {
  if (!substatus) return null;
  return String(substatus).replace(/_/g, ' ');
}

function buildEstadoResult(estado, mlStatus, mlSubstatus) {
  const mlSub = mlSubstatus ?? null;
  return {
    estado,
    substatus_ml: mlSub,
    ml_status: mlStatus ?? null,
    ml_substatus: mlSub,
    substatus: mlSub,
    substatus_display: mlSub ? formatSubstatus(mlSub) : null
  };
}

function mapearEstadoML(mlStatus, mlSubstatus = null) {

  // ==================== MAPEO DE SUBSTATUS ESPECÍFICOS ====================
  // Estos mapeos son SOLO para estados internos (KPIs, filtros, etc)
  // El substatus ORIGINAL de ML se guarda y muestra tal cual
  
  if (mlSubstatus) {
    
    // ========== INCIDENTES ESPECÍFICOS ==========
    
    if (mlSubstatus === 'receiver_absent') {
      return buildEstadoResult('comprador_ausente', mlStatus, mlSubstatus);
    }

    if (mlSubstatus === 'bad_address') {
      return buildEstadoResult('direccion_erronea', mlStatus, mlSubstatus);
    }

    if (mlSubstatus === 'not_visited') {
      return buildEstadoResult('no_visitado', mlStatus, mlSubstatus);
    }

    if (mlSubstatus === 'agency_closed') {
      return buildEstadoResult('sucursal_cerrada', mlStatus, mlSubstatus);
    }
    
    // ========== REPROGRAMACIONES ==========
    
    if (mlSubstatus === 'buyer_rescheduled') {
      return buildEstadoResult('reprogramado_comprador', mlStatus, mlSubstatus);
    }

    if (mlSubstatus === 'rescheduled_by_meli') {
      return buildEstadoResult('demorado', mlStatus, mlSubstatus);
    }
    
    // ========== DEMORAS ==========
    
    if (mlSubstatus === 'delayed') {
      return buildEstadoResult('demorado', mlStatus, mlSubstatus);
    }
    
    // ========== RECHAZOS Y DEVOLUCIONES ==========
    
    if (mlSubstatus === 'refused_delivery') {
      return buildEstadoResult('rechazado', mlStatus, mlSubstatus);
    }
    if (mlSubstatus === 'returned') {
      return buildEstadoResult('rechazado_comprador', mlStatus, mlSubstatus);
    }

    if (mlSubstatus === 'returning_to_sender') {
      return buildEstadoResult('devolucion', mlStatus, mlSubstatus);
    }
           
    // ========== PROXIMIDAD ==========
    
    if (mlSubstatus === 'soon_deliver') {
      return buildEstadoResult('llega_pronto', mlStatus, mlSubstatus);
    }
  }

  // ==================== MAPEO DE ESTADOS PRINCIPALES ====================

  // shipped → SIEMPRE en_camino (sin importar substatus)
  if (mlStatus === 'shipped') {
    return buildEstadoResult('en_camino', mlStatus, mlSubstatus);
  }

  // delivered → entregado (sin substatus)
  if (mlStatus === 'delivered') {
    return buildEstadoResult('entregado', mlStatus, null);
  }

  // cancelled → cancelado (sin substatus)
  if (mlStatus === 'cancelled') {
    return buildEstadoResult('cancelado', mlStatus, null);
  }

  // handling → en_planta
  if (mlStatus === 'handling') {
    return buildEstadoResult('en_planta', mlStatus, mlSubstatus);
  }

  // ready_to_pick → listo_retiro (a menos que tenga printed)
  if (mlStatus === 'ready_to_pick') {
    // Si NO tiene substatus printed, es listo_retiro genérico
    return buildEstadoResult('listo_retiro', mlStatus, mlSubstatus);
  }

  // ready_to_ship → pendiente
  if (mlStatus === 'ready_to_ship') {
    return buildEstadoResult('pendiente', mlStatus, mlSubstatus);
  }

  // not_delivered → no_entregado (si no matcheó ningún substatus específico)
  if (mlStatus === 'not_delivered') {
    return buildEstadoResult('no_entregado', mlStatus, mlSubstatus);
  }

  // Fallback
  return buildEstadoResult('pendiente', mlStatus, mlSubstatus);
}

function esBarridoGenerico(envio, nuevoEstado, hora, minutos) {
  if (!envio || !nuevoEstado) return false;

  const esHoraBarrido = hora === 23 && minutos >= 0 && minutos <= 30;
  if (!esHoraBarrido) return false;

  const mlSubstatusNuevo = (nuevoEstado.ml_substatus || nuevoEstado.substatus || '').toLowerCase();
  if (mlSubstatusNuevo !== 'rescheduled_by_meli') return false;

  const estadosEspecificos = new Set([
    'comprador_ausente',
    'inaccesible',
    'demorado'
  ]);

  const estadoActual = (envio.estado || '').toLowerCase();
  if (!estadosEspecificos.has(estadoActual)) return false;

  const ultimaActualizacionRaw =
    envio.estado_meli?.updatedAt ||
    envio.updated_at ||
    envio.updatedAt ||
    (Array.isArray(envio.historial_estados) && envio.historial_estados[0]?.fecha) ||
    envio.created_at ||
    envio.createdAt ||
    envio.fecha;

  if (!ultimaActualizacionRaw) return false;

  const ultimaActualizacion = new Date(ultimaActualizacionRaw);
  if (isNaN(+ultimaActualizacion)) return false;

  const horasDesdeUltimaActualizacion =
    (Date.now() - ultimaActualizacion.getTime()) / (1000 * 60 * 60);

  return horasDesdeUltimaActualizacion < 4;
}

// ---------------------------- helpers ----------------------------
// --- Tracking: mapea checkpoints a nuestro esquema ---
function mapFromTracking(tk) {
  const out = [];
  if (!tk) return out;

  // distintas variantes que devuelve MeLi
  const items = Array.isArray(tk.history) ? tk.history
              : Array.isArray(tk.events) ? tk.events
              : Array.isArray(tk.checkpoints) ? tk.checkpoints
              : [];

  const push = (dateVal, status, substatus, sourceKey, rawEvent = {}) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;

    const detalle = sanitizeStr(rawEvent.status_detail || rawEvent.detail || rawEvent.description);
    const subTexto = sanitizeStr(rawEvent.substatus || substatus);
    const descripcion = buildDescripcion(status, subTexto, detalle);
    const metadata = buildMetadataFromEvent(rawEvent);
    const ubicacion = normalizeLocation(rawEvent.location || rawEvent.address || rawEvent.place);

    const entry = {
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:tracking:${sourceKey}`
    };

    entry.descripcion = descripcion || null;
    entry.substatus_texto = subTexto || null;
    entry.notas = detalle || null;

    if (metadata) entry.metadata = metadata;
    if (ubicacion) entry.ubicacion = ubicacion;
    if (rawEvent?.id) entry.meli_event_id = String(rawEvent.id);

    out.push(entry);
  };

  for (const it of items) {
    const when = it.date || it.status_date || it.updated_at || it.created_at;
    const raw  = String(it.status || it.description || it.detail || '').toLowerCase();

    let status = null, sub = '';
    // Estados de tránsito con substatuses específicos
    if (/out[_\s-]?for[_\s-]?delivery|reparto/.test(raw)) {
      status = 'shipped'; sub = 'out_for_delivery';
    } else if (/ready[_\s-]?to[_\s-]?ship|listo/.test(raw)) {
      status = 'ready_to_ship'; sub = 'ready_to_print';
    } else if (/printed|impres/.test(raw)) {
      status = 'ready_to_ship'; sub = 'printed';
    } else if (/handling|preparaci[oó]n/.test(raw)) {
      status = 'ready_to_ship'; sub = 'handling';
    } else if (/in[_\s-]?transit|transit|camino/.test(raw)) {
      status = 'shipped'; sub = 'in_transit';
    } else if (/arriving[_\s-]?soon|llega[_\s-]?pronto/.test(raw)) {
      status = 'shipped'; sub = 'arriving_soon';

    // Estados problemáticos con detalle
    } else if (/receiver[_\s-]?absent|ausente|comprador[_\s-]?ausente/.test(raw)) {
      status = 'not_delivered'; sub = 'receiver_absent';
    } else if (/not[_\s-]?visited|no[_\s-]?visitado|inaccesible/.test(raw)) {
      status = 'not_delivered'; sub = 'not_visited';
    } else if (/bad[_\s-]?address|direcci[oó]n[_\s-]?err[oó]nea/.test(raw)) {
      status = 'not_delivered'; sub = 'bad_address';
    } else if (/agency[_\s-]?closed|sucursal[_\s-]?cerrada/.test(raw)) {
      status = 'not_delivered'; sub = 'agency_closed';

    // Demoras y reprogramaciones
    } else if (/delay(ed)?|demora/.test(raw)) {
      status = 'shipped'; sub = 'delayed';
    } else if (/rescheduled[_\s-]?by[_\s-]?meli|reprogramado[_\s-]?por[_\s-]?meli/.test(raw)) {
      status = 'shipped'; sub = 'rescheduled_by_meli';
    } else if (/rescheduled[_\s-]?by[_\s-]?buyer|reprogramado[_\s-]?por[_\s-]?comprador/.test(raw)) {
      status = 'shipped'; sub = 'rescheduled_by_buyer';

    // Entregado
    } else if (/delivered|entregado/.test(raw)) {
      status = 'delivered'; sub = '';

    // Cancelado
    } else if (/cancel/.test(raw)) {
      status = 'cancelled'; sub = '';
    } else if (/not[_\s-]?delivered/.test(raw)) {
      status = 'not_delivered'; sub = '';
    }

    if (status) push(when, status, sub, raw || 'checkpoint', it);
  }

  // orden + dedupe
  out.sort((a,b) => +new Date(a.at) - +new Date(b.at));
  const seen = new Set();
  const res = [];
  const key = h => keyOf(h);
  for (const h of out) {
    const k = key(h);
    if (!seen.has(k)) { seen.add(k); res.push(h); }
  }
  return res;
}


function procesarHistorialML(shipment) {
  if (!shipment || !Array.isArray(shipment.status_history)) {
    return [];
  }

  const historialOrdenado = [...shipment.status_history]
    .map(event => ({
      event,
      fecha: event.date_shipped || event.date_created || event.date || event.date_updated
    }))
    .filter(item => {
      if (!item.fecha) return false;
      const fecha = new Date(item.fecha);
      if (isNaN(+fecha)) return false;
      item.fecha = fecha;
      return true;
    })
    .sort((a, b) => a.fecha - b.fecha);

  const historialProcesado = [];
  let estadoAnterior = null;

  for (const { event, fecha } of historialOrdenado) {
    const mapped = mapearEstadoML(event.status, event.substatus);
    if (!mapped || !mapped.estado) continue;

    if (mapped.estado !== estadoAnterior) {
      historialProcesado.push({
        estado: mapped.estado,
        substatus: mapped.ml_substatus ?? null,
        substatus_display: mapped.substatus_display || (mapped.ml_substatus ? formatSubstatus(mapped.ml_substatus) : null),
        ml_status: mapped.ml_status,
        ml_substatus: mapped.ml_substatus,
        fecha,
        es_barrido_generico: false
      });

      estadoAnterior = mapped.estado;
    }
  }

  return historialProcesado.reverse();
}


function sortByAt(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(e => e && e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function pickDate(...cands) {
  for (const v of cands) {
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString();
  }
  return null;
}

function normalizeEvt(tipo, at, extra = {}) {
  if (!at) return null;
  return {
    source: 'meli-history',
    actor_name: 'MeLi',
    tipo,   // 'pendiente','listo_para_envio','en_camino','entregado', etc.
    at,
    ...extra,
  };
}

function mapMeliStatus(status, substatus) {
  const s = String(status || '').toLowerCase();
  const sub = String(substatus || '').toLowerCase();
  if (s === 'delivered') return 'entregado';
  if (s === 'ready_to_ship') return 'listo_para_envio';
  if (s === 'shipped' || s === 'in_transit' || s === 'handling') return 'en_camino';
  if (s === 'not_delivered' && sub === 'receiver_absent') return 'ausente';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'to_be_agreed') return 'pendiente';
  return 'pendiente';
}

// Sintetiza eventos cuando /history trae 0
function synthesizeFromShipment(shipment, ventaDateIso /* string o null */) {
  const evts = [];

  // 1) pendiente en venta (si hay)
  const ventaAt = pickDate(ventaDateIso, shipment?.date_created);
  if (ventaAt) {
    const e = normalizeEvt('pendiente', ventaAt);
    if (e) evts.push(e);
  }

  // 2) estado actual del shipment con la mejor fecha conocida
  const tipo = mapMeliStatus(shipment?.status, shipment?.substatus);
  const statusAt = pickDate(
    shipment?.status_history?.date,
    shipment?.delivered_date,
    shipment?.date_delivered,
    shipment?.last_updated,
    shipment?.date_last_updated,
    shipment?.date_updated
  );
  const e2 = normalizeEvt(tipo, statusAt);
  if (e2) evts.push(e2);

  return evts.filter(Boolean);
}

function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || h?.estado || h?.tipo || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || h?.substatus_texto || '').toLowerCase();
  const src = (h?.source || '').toLowerCase();
  const eventId = (h?.meli_event_id || '').toLowerCase();
  const desc = (h?.descripcion || h?.notas || h?.note || '').toString().toLowerCase();

  if (eventId) {
    return `${eventId}|${ts}|${src}`;
  }

  return `${ts}|${mst}|${mss}|${src}|${desc}`;
}

// Mapea el /history crudo de MeLi a nuestro formato
function mapHistory(items = []) {
  const out = [];
  for (const e of (Array.isArray(items) ? items : [])) {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();

    // completar sub si vino vacío y el status es útil
    if (!sub && [
      'ready_to_print','printed','out_for_delivery','not_visited',
      'ready_to_ship','handling','shipped','in_transit'
    ].includes(st)) {
      sub = st;
    }

    // tomar fecha; si no hay, salteamos (no inventamos now)
    const rawDate = e?.date || e?.date_created || e?.created_at;
    if (!rawDate) continue;
    const at = new Date(rawDate);
    if (isNaN(+at)) continue;

    const detalle = sanitizeStr(e?.status_detail || e?.description || e?.detail);
    const subTexto = sanitizeStr(e?.substatus);
    const descripcion = buildDescripcion(e?.status, subTexto || sub, detalle);
    const metadata = buildMetadataFromEvent(e);
    const ubicacion = normalizeLocation(e?.location || e?.address || e?.place || e?.agency_address);

    const entry = {
      at,
      estado: e?.status || '',
      estado_meli: { status: e?.status || '', substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history',
      descripcion: descripcion || null,
      substatus_texto: subTexto || null,
      notas: detalle || null
    };

    if (metadata) entry.metadata = metadata;
    if (ubicacion) entry.ubicacion = ubicacion;
    if (e?.id || e?.uid || e?.event_id) {
      entry.meli_event_id = String(e.id || e.uid || e.event_id);
    }

    out.push(entry);
  }
  return out;
}

async function getShipment(access, idOrTracking) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/shipments/${idOrTracking}`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000,
        validateStatus: s => s >= 200 && s < 500,
      }
    );
    if (r.status >= 400) return null;
    return r.data || null;
  } catch { return null; }
}

async function getHistory(access, shipmentId) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/shipments/${shipmentId}/history`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000,
        validateStatus: s => s >= 200 && s < 500,
      }
    );
    if (r.status >= 400) return [];
    const data = r.data ?? [];
    const raw = Array.isArray(data)
      ? data
      : (data.results ?? data.history ?? data.entries ?? data.events ?? []);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

async function getTracking(access, shipmentId) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/shipments/${shipmentId}/tracking`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000,
        validateStatus: s => s >= 200 && s < 500,
      }
    );
    if (r.status >= 400) return null;
    return r.data || null;
  } catch {
    return null;
  }
}

async function getShipmentFromOrder(access, orderId) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/orders/${orderId}/shipments`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000,
        validateStatus: s => s >= 200 && s < 500,
      }
    );
    if (r.status >= 400) return null;
    const data = r.data || {};
    const arr = Array.isArray(data) ? data : (data.results || []);
    return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
  } catch { return null; }
}

// Fallback extra: escanear shipment por campos/fechas conocidas
// ---- síntesis cuando /history viene vacío (usa fechas REALES y todos los intermedios) ----
function buildHistoryFromShipment(sh) {
  if (!sh || typeof sh !== 'object') return [];

  const out = [];
  const dh = sh.date_history && typeof sh.date_history === 'object' ? sh.date_history : {};

  // helper
  const push = (dateVal, status, substatus, sourceKey, extra = {}) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;
    const detalle = sanitizeStr(extra.notas || extra.detalle);
    const subTexto = sanitizeStr(extra.substatus_texto || substatus);
    const descripcion = buildDescripcion(status, subTexto || substatus, detalle);

    const entry = {
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:shipment:${sourceKey}`,
      descripcion: descripcion || null,
      substatus_texto: subTexto || null,
      notas: detalle || null
    };

    const metadata = extra.metadata && typeof extra.metadata === 'object' && Object.keys(extra.metadata).length
      ? extra.metadata
      : null;
    if (metadata) entry.metadata = metadata;
    if (extra.ubicacion) entry.ubicacion = extra.ubicacion;
    if (extra.meli_event_id) entry.meli_event_id = extra.meli_event_id;

    out.push(entry);
  };
  const pick = (...vals) => {
    for (const v of vals) {
      const d = v && (v.date || v); // a veces viene { date: "..." }
      if (!d) continue;
      const dt = new Date(d);
      if (!isNaN(+dt)) return d;
    }
    return null;
  };

  // 1) Estados iniciales (pendiente/listo para envío)
  //    Guardamos printed/ready_to_print como "ready_to_ship" con substatus correspondiente
  const dtReadyToPrint = pick(dh.ready_to_print, dh.printed, sh.date_ready_to_print, sh.date_printed);
  if (dtReadyToPrint) {
    // substatus: kept (printed si corresponde)
    const sub = dh.printed ? 'printed' : 'ready_to_print';
    push(dtReadyToPrint, 'ready_to_ship', sub, 'ready_to_print|printed');
  }

  // 2) Preparación / handling
  const dtHandling = pick(dh.handling, sh.date_handling);
  if (dtHandling) push(dtHandling, 'ready_to_ship', 'handling', 'handling');

  // 3) Despachado / en tránsito
  const dtShipped     = pick(dh.shipped, sh.date_shipped);
  const dtInTransit  = pick(dh.in_transit, sh.date_in_transit);
  if (dtShipped)    push(dtShipped,   'shipped', '', 'shipped');
  if (dtInTransit)  push(dtInTransit, 'shipped', '', 'in_transit');

  // 4) Salió a reparto
  const dtOFD = pick(dh.out_for_delivery, sh.date_out_for_delivery);
  if (dtOFD) push(dtOFD, 'shipped', 'out_for_delivery', 'out_for_delivery');

  // 5) Intento fallido / ausente
  const dtAbsent = pick(dh.receiver_absent, dh.not_delivered, sh.date_not_delivered, sh.date_receiver_absent);
  if (dtAbsent) {
    const intentos = (sh.delivery_attempts || sh.attempts || 0);
    const extra = intentos > 0 ? { metadata: { intentos } } : undefined;
    push(dtAbsent, 'not_delivered', 'receiver_absent', 'not_delivered|receiver_absent', extra);
  }

  // 6) Entregado
  const dtDelivered = pick(dh.delivered, sh.date_delivered, sh.delivered_date, sh.date_first_delivered);
  if (dtDelivered) push(dtDelivered, 'delivered', '', 'delivered');

  // 7) Cancelado
  const dtCancelled = pick(dh.cancelled, sh.date_cancelled, sh.date_canceled);
  if (dtCancelled) push(dtCancelled, 'cancelled', '', 'cancelled');

  // 8) Fallback único si igual no encontramos nada útil
  if (!out.length && sh.status) {
    const updated =
      sh.status_history?.date_updated ||
      sh.last_updated || sh.date_last_updated || sh.date_updated ||
      sh.date_delivered || sh.delivered_date ||
      sh.date_shipped || sh.date_created || new Date();
    const st  = String(sh.status).toLowerCase();
    const sub = String(sh.substatus || '').toLowerCase();
    push(updated, st, sub, 'status_fallback');
  }

  // Orden + dedupe estable (por fecha + status + substatus + source)
  out.sort((a,b) => +new Date(a.at) - +new Date(b.at));
  const seen = new Set();
  const res = [];
  for (const h of out) {
    const k = keyOf(h);
    if (!seen.has(k)) { seen.add(k); res.push(h); }
  }
  return res;
}


// ---------------------------- main ----------------------------
async function ensureMeliHistory(envioOrId, { token, force = false, rebuild = false } = {}) {
  const envio = typeof envioOrId === 'string'
    ? await Envio.findById(envioOrId).lean()
    : (envioOrId?.toObject ? envioOrId.toObject() : envioOrId);

  if (!envio?.meli_id) { dlog('skip sin meli_id', envio?._id?.toString?.()); return; }

  const last  = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;
  if (!force && fresh && !pobre) { dlog('fresh & no pobre → skip'); return; }

  // Token
  let access = token;
  if (!access) {
    const cliente = await Cliente.findById(envio.cliente_id).lean();
    if (!cliente?.user_id) { dlog('skip sin user_id'); return; }
    access = await getValidToken(cliente.user_id);
    if (!access) { dlog('skip sin access'); return; }
  }

  // Shipment
  let sh = await getShipment(access, envio.meli_id);
  let shipmentId = envio.meli_id;

  // ========== EXTRAER COORDENADAS DE MERCADOLIBRE ==========
  let meliLat = null;
  let meliLon = null;

  const extractMeliCoords = (shipment, shipmentIdForLog) => {
    if (shipment && shipment.receiver_address) {
      const addr = shipment.receiver_address;

      meliLat = addr.latitude || addr.lat || addr.geolocation?.latitude || null;
      meliLon = addr.longitude || addr.lon || addr.lng || addr.geolocation?.longitude || null;

      if (meliLat && meliLon) {
        const latNum = Number(meliLat);
        const lonNum = Number(meliLon);

        const isValid = (
          !isNaN(latNum) && !isNaN(lonNum) &&
          latNum !== 0 && lonNum !== 0 &&
          latNum >= -55.1 && latNum <= -21.7 &&
          lonNum >= -73.6 && lonNum <= -53.5
        );

        if (isValid) {
          logger.debug('Coords de MeLi (history)', {
            shipment_id: shipmentIdForLog,
            lat: latNum,
            lon: lonNum
          });
          meliLat = latNum;
          meliLon = lonNum;
        } else {
          logger.warn('Coords inválidas/fuera de Argentina (history)', {
            shipment_id: shipmentIdForLog,
            lat: latNum,
            lon: lonNum
          });
          meliLat = null;
          meliLon = null;
        }
      }
    }
  };

  extractMeliCoords(sh, shipmentId);
  // ========== FIN EXTRACCIÓN COORDENADAS ==========

  if (sh?.id) {
    if (`${sh.id}` !== `${envio.meli_id}`) {
      dlog('autocorrect meli_id', { before: envio.meli_id, after: sh.id });
      shipmentId = `${sh.id}`;
      await Envio.updateOne({ _id: envio._id }, { $set: { meli_id: shipmentId } });
    }
  } else {
    const orderId = envio.venta_id_meli || envio.order_id_meli || envio.order_id;
    if (orderId) {
      const resolved = await getShipmentFromOrder(access, orderId);
      if (resolved) {
        dlog('autocorrect meli_id via order', { orderId, shipmentId: resolved });
        shipmentId = `${resolved}`;
        await Envio.updateOne({ _id: envio._id }, { $set: { meli_id: shipmentId } });
        sh = await getShipment(access, shipmentId);
        extractMeliCoords(sh, shipmentId);
      } else {
        dlog('order→shipment no resolvió', { orderId });
      }
    } else {
      dlog('no orderId para resolver shipment');
    }
  }

  // History remoto
  let raw = await getHistory(access, shipmentId);
  let mapped = mapHistory(raw);

  // AGREGAR: Rellenar substatus faltante con el substatus actual del shipment
  if (sh && sh.substatus && mapped.length > 0) {
    // Para los eventos más recientes de "shipped", usar el substatus actual
    const substatusActual = sh.substatus;
    const statusActual = sh.status;

    // Buscar el evento más reciente que coincida con el status actual
    for (let i = mapped.length - 1; i >= 0; i--) {
      const evt = mapped[i];

      // Si el evento tiene el mismo status que el shipment actual pero no tiene substatus
      if (evt.estado === statusActual && (!evt.estado_meli.substatus || evt.estado_meli.substatus === '')) {
        evt.estado_meli.substatus = substatusActual;
        evt.substatus_texto = substatusActual;

        // Actualizar descripción
        const detalle = evt.notas || evt.descripcion;
        evt.descripcion = buildDescripcion(statusActual, substatusActual, detalle);

        logger.debug('[meliHistory] Completando substatus faltante', {
          envio_id: shipmentId,
          status: statusActual,
          substatus: substatusActual,
          evento_fecha: evt.at
        });

        // Solo actualizar el más reciente
        break;
      }
    }
  }

  // NUEVO: Preservar estados específicos antes de barrido genérico
  // Si el shipment actual tiene rescheduled_by_meli, verificar si antes tuvo estados específicos
  if (sh && sh.substatus === 'rescheduled_by_meli') {
    // Lista de substatuses específicos que queremos preservar
    const SUBSTATUSES_ESPECIFICOS = [
      'receiver_absent',
      'not_visited',
      'bad_address',
      'agency_closed',
      'delayed',
      'out_for_delivery',
      'arriving_soon'
    ];

    // Buscar eventos específicos en el historial crudo de MeLi
    const eventosEspecificos = raw.filter(e => {
      const sub = String(e?.substatus || '').toLowerCase();
      return SUBSTATUSES_ESPECIFICOS.includes(sub);
    });

    if (eventosEspecificos.length > 0) {
      // Para cada evento específico, verificar que esté en el historial mapeado
      for (const eventoMeli of eventosEspecificos) {
        const subEspecifico = String(eventoMeli.substatus).toLowerCase();

        // ¿Ya está en el historial?
        const yaEstaEnHistorial = mapped.some(evt =>
          evt.estado_meli?.substatus === subEspecifico
        );

        if (!yaEstaEnHistorial) {
          // Recuperar el evento
          const fechaEvento = new Date(
            eventoMeli.date ||
            eventoMeli.date_created ||
            eventoMeli.created_at
          );

          if (!isNaN(fechaEvento)) {
            const detalle = sanitizeStr(
              eventoMeli.status_detail ||
              eventoMeli.description ||
              eventoMeli.detail
            );

            const eventoRecuperado = {
              at: fechaEvento,
              estado: eventoMeli.status || 'shipped',
              estado_meli: {
                status: eventoMeli.status || 'shipped',
                substatus: subEspecifico
              },
              actor_name: 'MeLi',
              source: 'meli-history',
              descripcion: buildDescripcion(
                eventoMeli.status,
                subEspecifico,
                detalle
              ),
              substatus_texto: subEspecifico,
              notas: detalle || null
            };

            // Insertar en orden cronológico
            mapped.push(eventoRecuperado);

            logger.info('[meliHistory] Recuperado evento específico', {
              envio_id: shipmentId,
              substatus: subEspecifico,
              fecha: fechaEvento.toISOString()
            });
          }
        }
      }

      // Re-ordenar después de agregar todos los eventos
      mapped.sort((a, b) => new Date(a.at) - new Date(b.at));
    }
  }

  // --- si el shipment está en un estado terminal y el history no lo trae,
//     agregamos un evento sintético con la fecha real del shipment ---
if (sh && sh.status) {
  const term = new Set(['delivered', 'cancelled', 'not_delivered']);
  const shStatus = String(sh.status).toLowerCase();
  if (term.has(shStatus)) {
    const lastMappedStatus = (mapped[mapped.length - 1]?.estado_meli?.status || '')
      .toString()
      .toLowerCase();

    if (lastMappedStatus !== shStatus) {
      // elegimos la mejor fecha disponible para ese estado final
      const when = pickDate(
        sh.date_delivered,
        sh.status_history?.date_updated,
        sh.last_updated,
        sh.date_last_updated,
        sh.date_updated,
        sh.date_created
      );

      // armamos el evento en el mismo formato que mapHistory()
      mapped.push({
        at: new Date(when || Date.now()),
        estado: sh.status, // dejamos el status ML crudo para consistencia con mapHistory
        estado_meli: { status: sh.status, substatus: sh.substatus || '' },
        actor_name: 'MeLi',
        source: 'meli-history:shipment:terminal'
      });
    }
  }
}

  // Fallback si está vacío
  if (!mapped.length && sh) {
    const ventaIso = envio?.fecha ? new Date(envio.fecha).toISOString() : null; // ajustá si tu campo difiere
    const synth = synthesizeFromShipment(sh, ventaIso);
    if (synth.length) {
      dlog('history vacío → sintetizo desde shipment con fechas reales', synth.length);
      // convertir nuestros "tipo" a estado_meli coherente para el merge
      const mappedSynth = synth.map(e => {
        // traducir "tipo" a status meli aproximado
        const t = (e.tipo || '').toLowerCase();
        let status = 'ready_to_ship';
        if (t === 'entregado') status = 'delivered';
        else if (t === 'en_camino') status = 'shipped';
        else if (t === 'ausente') status = 'not_delivered';
        else if (t === 'cancelado') status = 'cancelled';
        return {
          at: new Date(e.at),
          estado: status,
          estado_meli: { status, substatus: '' },
          actor_name: 'MeLi',
          source: e.source || 'meli-history:synth'
        };
      });
      mapped = mappedSynth;
    }
  }

  // Intento extra: TRACKING para completar intermedios
try {
  const needOFD = !mapped.some(h => (h.estado_meli?.status === 'shipped' && h.estado_meli?.substatus === 'out_for_delivery'));
  const needShip = !mapped.some(h => h.estado_meli?.status === 'shipped');
  if (needOFD || needShip) {
    const tk = await getTracking(access, shipmentId);
    const tkMapped = mapFromTracking(tk);
    if (tkMapped.length) {
      dlog('completo con tracking', tkMapped.length);
      // merge + dedupe por fecha/status/sub/source
      const all = [...mapped, ...tkMapped].sort((a,b) => +new Date(a.at) - +new Date(b.at));
      const seen = new Set();
      const res = [];
      const key = h => `${+new Date(h.at)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}|${(h.source||'').toLowerCase()}`;
      for (const h of all) {
        const k = key(h);
        if (!seen.has(k)) { seen.add(k); res.push(h); }
      }
      mapped = res;
    }
  }
} catch (e) {
  dlog('tracking merge error', e?.message || e);
}
  // Mezcla con historial actual y dedupe
  const current = (await Envio.findById(envio._id).select('historial estado estado_meli').lean()) || {};
  const currentArr = Array.isArray(current.historial) ? current.historial : [];

  const update = { $set: { meli_history_last_sync: new Date() } };

  if (rebuild) {
    // 1) conservar NO-MeLi
    const nonMeli = currentArr.filter(h =>
      h?.actor_name !== 'MeLi' &&
      h?.source !== 'meli-history' &&
      !(String(h?.source||'').startsWith('meli-history:shipment')) &&
      !(String(h?.source||'').startsWith('meli-history:synth'))
    );

    // 2) unir con lo nuevo de MeLi
    let merged = [...nonMeli, ...mapped];

    // 3) ordenar y dedupe por keyOf
    merged = sortByAt(merged);
    const seen = new Set();
    const deduped = [];
    for (const h of merged) {
      const k = keyOf(h);
      if (!seen.has(k)) { seen.add(k); deduped.push(h); }
    }

    update.$set.historial = deduped;
  } else {
    // incremental
    const seen = new Set(currentArr.map(keyOf));
    const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));
    if (toAdd.length) update.$push = { historial: { $each: toAdd } };
  }

  // ---- estado_meli final con fechas reales ----
  const all = (rebuild
    ? (update.$set.historial || [])
    : [...currentArr, ...((update.$push?.historial?.$each) || [])]
  );

  // ¿Hay delivered en la línea de tiempo? (con su fecha real)
  const deliveredEvt = (Array.isArray(all) ? all : [])
    .filter(h => (h?.estado_meli?.status || h?.estado || '').toString().toLowerCase() === 'delivered')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0];

  // último evento por fecha
  const lastEvt = all
    .slice()
    .sort((a, b) => new Date(b.at || b.updatedAt || 0) - new Date(a.at || a.updatedAt || 0))[0];

  const fallbackDate =
    (sh && (sh.date_delivered || sh.date_first_delivered)) ? new Date(sh.date_delivered || sh.date_first_delivered)
    : (sh && (sh.status_history?.date_shipped || sh.date_shipped)) ? new Date(sh.status_history?.date_shipped || sh.date_shipped)
    : (sh && sh.date_created) ? new Date(sh.date_created)
    : new Date();

  const stBase  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || envio?.estado_meli?.status || '').toString();
  const subBase = (lastEvt?.estado_meli?.substatus || sh?.substatus || envio?.estado_meli?.substatus || '').toString();

  // Si hay delivered real, priorizamos ese estado/fecha
  let stFinal   = deliveredEvt ? 'delivered' : stBase;
  let subFinal  = deliveredEvt ? (deliveredEvt?.estado_meli?.substatus || '') : subBase;

  // Buscar ausencia en historial nuevo
  const huboAusente = all.some(h => {
    const sub = (h?.estado_meli?.substatus || '').toLowerCase();
    return /(receiver|buyer|client|addressee)[_\s-]?absent/.test(sub);
  });

  // Buscar ausencia en historial que ya está en BD
  const huboAusenteEnBD = currentArr.some(h => {
    const sub = (h?.estado_meli?.substatus || '').toLowerCase();
    return /(receiver|buyer|client|addressee)[_\s-]?absent/.test(sub);
  });

  // Combinar todas las detecciones
  const huboAusenteFinal = huboAusente || huboAusenteEnBD || envio.comprador_ausente_confirmado;

  // Debug logging
  logger.info('[meliHistory] Detección de ausencia', {
    envio_id: envio.meli_id || envio._id,
    subFinal: subFinal,
    statusFinal: stFinal,
    huboAusente_nuevo: huboAusente,
    huboAusente_BD: huboAusenteEnBD,
    flag_confirmado: envio.comprador_ausente_confirmado,
    huboAusenteFinal: huboAusenteFinal,
    historial_nuevo_length: all.length,
    historial_BD_length: currentArr.length,
    substatuses_BD: currentArr.slice(-5).map(h => h?.estado_meli?.substatus).filter(Boolean)
  });
  const dateFinal = deliveredEvt ? (deliveredEvt.at || fallbackDate) : (lastEvt?.at || fallbackDate);

  // **Nunca** dejar substatus en delivered
  if (String(stFinal).toLowerCase() === 'delivered') subFinal = '';

  // ========== LÓGICA MEJORADA DE PRIORIZACIÓN DE ESTADOS ==========

  // Categorías de eventos por especificidad
  const EVENTOS_ESPECIFICOS = new Set([
    'receiver_absent',      // Comprador ausente
    'not_visited',          // Inaccesible/avería
    'bad_address',          // Dirección errónea
    'agency_closed',        // Agencia cerrada
    'rescheduled_by_buyer', // Reprogramado por comprador
    'out_for_delivery',     // Salió a reparto
    'arriving_soon'         // Llega pronto
  ]);

  const EVENTOS_GENERICOS = new Set([
    'rescheduled_by_meli',  // Barrido genérico de MeLi
    'delayed',              // Demorado genérico
    'in_transit',           // En tránsito genérico
    'shipped'               // Enviado genérico
  ]);

  const TERMINALES = new Set(['delivered', 'cancelled', 'canceled']);

  // Función para determinar especificidad de un evento
  function getEventSpecificity(h) {
    const sub = (h?.estado_meli?.substatus || '').toLowerCase();
    let status = (h?.estado_meli?.status || h?.estado || '').toLowerCase();
    
    // Normalizar grafías alternativas
    if (status === 'canceled') status = 'cancelled';
    
    if (TERMINALES.has(status)) return 3; // Máxima prioridad
    if (EVENTOS_ESPECIFICOS.has(sub)) return 2; // Alta prioridad
    if (EVENTOS_GENERICOS.has(sub)) return 1; // Baja prioridad
    return 1; // Default: prioridad baja
  }

  // Obtener el evento más relevante con ventana temporal
  const ahora = new Date();
  const eventosConPrioridad = all
    .filter(h => h?.at && h?.estado_meli)
    .map(h => {
      const especificidad = getEventSpecificity(h);
      const fecha = new Date(h.at);
      const antiguedad = (ahora - fecha) / (1000 * 60 * 60); // Horas
      
      // Dar bonus a eventos específicos recientes (últimas 48h)
      let prioridad = especificidad;
      if (especificidad === 2 && antiguedad <= 48) {
        prioridad = 2.5; // Boost a eventos específicos recientes
      }
      
      return { evento: h, especificidad, prioridad, fecha, antiguedad };
    })
    .sort((a, b) => {
      // Primero por prioridad (mayor = mejor)
      if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
      
      // Luego por fecha (más reciente = mejor)
      return b.fecha - a.fecha;
    });

  logger.debug('Eventos ordenados por prioridad', {
    envio_id: envio._id?.toString?.(),
    eventos: eventosConPrioridad.map(e => ({
      sub: e.evento.estado_meli?.substatus,
      especificidad: e.especificidad,
      prioridad: e.prioridad,
      antiguedad_horas: Number(e.antiguedad.toFixed(1))
    }))
  });

  // El primer evento de la lista es el más relevante
  const eventoRelevante = eventosConPrioridad[0]?.evento;

  let statusFinal = stFinal;
  let substatusFinal = subFinal;
  let fechaFinal = dateFinal;

  if (eventoRelevante) {
    statusFinal = eventoRelevante.estado_meli?.status || eventoRelevante.estado || stFinal;
    substatusFinal = eventoRelevante.estado_meli?.substatus || subFinal;
    fechaFinal = eventoRelevante.at || dateFinal;

    logger.info('Evento MeLi relevante', {
      envio_id: envio._id?.toString?.(),
      fecha: fechaFinal,
      status: statusFinal,
      substatus: substatusFinal,
      especificidad: eventosConPrioridad[0].especificidad,
      prioridad: eventosConPrioridad[0].prioridad
    });
  }

  // Nunca revertir estados terminales
  const prevStatusNorm = (current?.estado_meli?.status || '').toLowerCase();
  const statusFinalNorm = statusFinal.toLowerCase();

  const prevEsTerminal = TERMINALES.has(prevStatusNorm) || TERMINALES.has(prevStatusNorm === 'canceled' ? 'cancelled' : prevStatusNorm);
  const nuevoEsTerminal = TERMINALES.has(statusFinalNorm) || TERMINALES.has(statusFinalNorm === 'canceled' ? 'cancelled' : statusFinalNorm);

  if (prevEsTerminal && !nuevoEsTerminal) {
    logger.debug('Conservando estado terminal', {
      envio_id: envio._id?.toString?.(),
      status: current.estado_meli.status
    });
    statusFinal = current.estado_meli.status;
    substatusFinal = current.estado_meli.substatus;
    fechaFinal = current.estado_meli.updatedAt || fechaFinal;
  }

  // ========== FIN LÓGICA DE PRIORIZACIÓN ==========

  const estadoMapeado = mapearEstadoML(statusFinal, substatusFinal);
  let estadoFinal = estadoMapeado.estado;
  const mlStatusFinal = estadoMapeado.ml_status || statusFinal || null;
  const mlSubstatusFinal = estadoMapeado.ml_substatus !== undefined
    ? estadoMapeado.ml_substatus
    : substatusFinal;

  const horaActual = ahora.getHours();
  const minutosActuales = ahora.getMinutes();
  const esBarrido = esBarridoGenerico(envio, estadoMapeado, horaActual, minutosActuales);

  if (esBarrido) {
    logger.warn('[meliHistory] Barrido genérico detectado', {
      envio_id: envio._id?.toString?.(),
      tracking: envio.tracking || envio.tracking_id || envio.trackingId || envio.meli_id || envio.id_venta || null,
      estado_anterior: envio.estado,
      ml_substatus_anterior: envio.ml_substatus,
      ml_substatus_nuevo: estadoMapeado.ml_substatus,
      hora: `${horaActual}:${String(minutosActuales).padStart(2, '0')}`
    });

    estadoFinal = envio.estado || estadoFinal;
  }

  if (huboAusenteFinal && /resched.*meli/.test((substatusFinal || '').toLowerCase())) {
    logger.info('[meliHistory] Preservando comprador_ausente', {
      envio_id: envio.meli_id || envio._id,
      razon: 'hubo receiver_absent previo'
    });
    estadoFinal = 'comprador_ausente';
  }

  if (envio.comprador_ausente_confirmado && estadoFinal !== 'entregado' && estadoFinal !== 'cancelado') {
    estadoFinal = 'comprador_ausente';
  }

  update.$set.estado = estadoFinal;
  update.$set.ml_status = mlStatusFinal || null;
  update.$set.ml_substatus = mlSubstatusFinal || null;
  update.$set.estado_meli = {
    status: mlStatusFinal,
    substatus: mlSubstatusFinal,
    updatedAt: fechaFinal
  };

  // Marcar flag permanente si confirmamos ausencia
  if (estadoFinal === 'comprador_ausente') {
    update.$set.comprador_ausente_confirmado = true;
  }

  // Guardar coordenadas de MeLi si existen y no están ya guardadas
  if (meliLat && meliLon) {
    const envioActual = await Envio.findById(envio._id).select('latitud longitud geocode_source').lean();

    if (!envioActual?.latitud || !envioActual?.longitud || envioActual?.geocode_source !== 'mercadolibre') {
      update.$set.latitud = meliLat;
      update.$set.longitud = meliLon;
      update.$set.geocode_source = 'mercadolibre';
      logger.debug('Guardando coordenadas de MeLi (history)', {
        shipment_id: shipmentId,
        envio_id: envio._id?.toString?.()
      });
    }
  }

  const historialEstados = procesarHistorialML(sh);

  if (esBarrido) {
    const substatusDisplayBarrido = estadoMapeado.substatus_display
      || (estadoMapeado.ml_substatus ? formatSubstatus(estadoMapeado.ml_substatus) : null);

    const entradaBarrido = {
      estado: estadoFinal || envio.estado || 'pendiente',
      substatus: estadoMapeado.ml_substatus ?? null,
      substatus_display: substatusDisplayBarrido,
      ml_status: mlStatusFinal,
      ml_substatus: estadoMapeado.ml_substatus ?? null,
      fecha: ahora,
      es_barrido_generico: true
    };

    const yaRegistrado = Array.isArray(envio.historial_estados)
      ? envio.historial_estados.some(h =>
          h?.es_barrido_generico &&
          h.estado === entradaBarrido.estado &&
          h.ml_substatus === entradaBarrido.ml_substatus &&
          h.ml_status === entradaBarrido.ml_status)
      : false;

    if (!yaRegistrado) {
      historialEstados.unshift(entradaBarrido);
    }
  }

  update.$set.historial_estados = historialEstados;

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = {
  ensureMeliHistory,
  mapearEstadoML,
  esBarridoGenerico,
  formatSubstatus,
  procesarHistorialML,
  'meliHistory.v3-sintetiza-desde-shipment': true
};
