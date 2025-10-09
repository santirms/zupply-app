// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

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

  const push = (dateVal, status, substatus, sourceKey) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;
    out.push({
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:tracking:${sourceKey}`
    });
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

    if (status) push(when, status, sub, raw || 'checkpoint');
  }

  // orden + dedupe
  out.sort((a,b) => +new Date(a.at) - +new Date(b.at));
  const seen = new Set();
  const res = [];
  const key = h => `${+new Date(h.at)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}|${(h.source||'').toLowerCase()}`;
  for (const h of out) {
    const k = key(h);
    if (!seen.has(k)) { seen.add(k); res.push(h); }
  }
  return res;
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
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  const src = (h?.source || '').toLowerCase();
  return `${ts}|${mst}|${mss}|${src}`;
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

    out.push({
      at,
      estado: e?.status || '',
      estado_meli: { status: e?.status || '', substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history',
    });
  }
  return out;
}

function mapToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();

  // 1. Estados terminales (máxima prioridad)
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled' || s === 'canceled') return 'cancelado';

  // 2. Problemas de entrega (prioridad alta - ANTES de shipped genérico)
  if (s === 'not_delivered') {
    if (/receiver[_\s-]?absent|ausente/.test(sub)) return 'comprador_ausente';
    if (/not[_\s-]?visited|inaccesible/.test(sub)) return 'inaccesible';
    if (/bad[_\s-]?address|direcci[oó]n/.test(sub)) return 'direccion_erronea';
    if (/agency[_\s-]?closed/.test(sub)) return 'agencia_cerrada';
    return 'no_entregado';
  }

  // 3. Demoras y reprogramaciones (prioridad media-alta)
  if (/rescheduled?[_\s-]?by[_\s-]?buyer/.test(sub)) return 'reprogramado';
  if (/rescheduled?[_\s-]?by[_\s-]?meli/.test(sub)) return 'demorado';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub)) return 'demorado';

  // 4. En tránsito activo (prioridad media)
  if (s === 'shipped' || s === 'in_transit' || s === 'out_for_delivery') {
    // Si hay substatus problemático, priorizarlo
    if (/delay/.test(sub)) return 'demorado';
    if (/resched/.test(sub)) return 'reprogramado';
    return 'en_camino';
  }

  // 5. Preparación (prioridad baja)
  if (s === 'ready_to_ship' || s === 'handling' || s === 'ready_to_print' || s === 'printed') {
    return 'pendiente';
  }

  // 6. Fallback
  return 'pendiente';
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
  const push = (dateVal, status, substatus, sourceKey) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;
    out.push({
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:shipment:${sourceKey}`
    });
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
  if (dtAbsent) push(dtAbsent, 'not_delivered', 'receiver_absent', 'not_delivered|receiver_absent');
  // Contar intentos de entrega fallidos
  const intentos = (sh.delivery_attempts || sh.attempts || 0);
  if (dtAbsent && intentos > 0) {
    out[out.length - 1].metadata = { intentos };
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
  const keyOf = (h) => `${+new Date(h.at)}|${(h.estado||'').toLowerCase()}|${(h.estado_meli?.substatus||'').toLowerCase()}|${(h.source||'').toLowerCase()}`;
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
          console.log(`📍 Coords de MeLi para ${shipmentIdForLog}:`, { lat: latNum, lon: lonNum });
          meliLat = latNum;
          meliLon = lonNum;
        } else {
          console.warn(`⚠️ Coords inválidas/fuera de Argentina para ${shipmentIdForLog}:`, { lat: latNum, lon: lonNum });
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
  const dateFinal = deliveredEvt ? (deliveredEvt.at || fallbackDate) : (lastEvt?.at || fallbackDate);

  // **Nunca** dejar substatus en delivered
  if (String(stFinal).toLowerCase() === 'delivered') subFinal = '';

  // ========== LÓGICA DE PRIORIZACIÓN DE ESTADOS ==========

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

    // Normalizar grafías alternativas de MercadoLibre
    if (status === 'canceled') status = 'cancelled';

    if (TERMINALES.has(status)) return 3; // Máxima prioridad
    if (EVENTOS_ESPECIFICOS.has(sub)) return 2; // Alta prioridad
    if (EVENTOS_GENERICOS.has(sub)) return 1; // Baja prioridad
    return 1; // Default: prioridad baja
  }

  // Obtener el evento más relevante (no solo el más reciente)
  const eventosOrdenados = all
    .filter(h => h?.at && h?.estado_meli)
    .sort((a, b) => {
      // Primero por especificidad (descendente)
      const specA = getEventSpecificity(a);
      const specB = getEventSpecificity(b);
      if (specA !== specB) return specB - specA;

      // Luego por fecha (descendente)
      return new Date(b.at) - new Date(a.at);
    });

  // El primer evento de la lista es el más relevante
  const eventoRelevante = eventosOrdenados[0];

  let estadoFinal = 'pendiente';
  let statusFinal = stFinal;
  let substatusFinal = subFinal;
  let fechaFinal = dateFinal;

  if (eventoRelevante) {
    statusFinal = eventoRelevante.estado_meli?.status || eventoRelevante.estado || stFinal;
    substatusFinal = eventoRelevante.estado_meli?.substatus || subFinal;
    fechaFinal = eventoRelevante.at || dateFinal;

    // Mapear a estado interno
    estadoFinal = mapToInterno(statusFinal, substatusFinal);

    console.log(`🎯 Evento más relevante para ${envio._id}:`, {
      fecha: fechaFinal,
      status: statusFinal,
      substatus: substatusFinal,
      especificidad: getEventSpecificity(eventoRelevante),
      estadoInterno: estadoFinal
    });
  } else {
    // Fallback al último evento conocido
    estadoFinal = mapToInterno(stFinal, subFinal);
  }

  // Nunca revertir estados terminales
  // Normalizar antes de verificar
  let statusFinalNorm = (statusFinal || '').toLowerCase();
  if (statusFinalNorm === 'canceled') statusFinalNorm = 'cancelled';

  let statusPrevNorm = (current?.estado_meli?.status || '').toLowerCase();
  if (statusPrevNorm === 'canceled') statusPrevNorm = 'cancelled';

  const prevEsTerminal = TERMINALES.has(statusPrevNorm);
  const nuevoEsTerminal = TERMINALES.has(statusFinalNorm);

  if (prevEsTerminal && !nuevoEsTerminal) {
    const statusPrev = current?.estado_meli?.status || statusFinal;
    console.log(`🔒 Conservando estado terminal: ${statusPrev}`);
    estadoFinal = current?.estado || estadoFinal;
    statusFinal = statusPrev;
    substatusFinal = current?.estado_meli?.substatus || substatusFinal;
    fechaFinal = current?.estado_meli?.updatedAt || fechaFinal;
  }

  // ========== FIN LÓGICA DE PRIORIZACIÓN ==========

  update.$set.estado = estadoFinal;
  update.$set.estado_meli = {
    status: statusFinal,
    substatus: substatusFinal,
    updatedAt: fechaFinal
  };

  // Guardar coordenadas de MeLi si existen y no están ya guardadas
  if (meliLat && meliLon) {
    const envioActual = await Envio.findById(envio._id).select('latitud longitud geocode_source').lean();

    if (!envioActual?.latitud || !envioActual?.longitud || envioActual?.geocode_source !== 'mercadolibre') {
      update.$set.latitud = meliLat;
      update.$set.longitud = meliLon;
      update.$set.geocode_source = 'mercadolibre';
      console.log(`💾 Guardando coordenadas de MeLi para ${shipmentId}`);
    }
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = {
  ensureMeliHistory,
  'meliHistory.v3-sintetiza-desde-shipment': true
};
