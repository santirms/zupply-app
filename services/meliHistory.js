// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

// ---------------------------- helpers ----------------------------
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
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled' || s === 'canceled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped' || s === 'in_transit' || s === 'out_for_delivery') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling' || s === 'ready_to_print' || s === 'printed') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
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
function buildHistoryFromShipment(sh) {
  if (!sh || typeof sh !== 'object') return [];

  const out = [];

  // helper para pushear un evento validando fecha
  const pushEvent = (dateVal, status, substatus, sourceKey) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;
    out.push({
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:shipment:${sourceKey || 'date'}`
    });
  };

  // 1) PENDIENTE / printed: fecha de creación
  // (tu UI lo mapea a "Pendiente / printed")
  pushEvent(
    sh.date_created || sh.status_history?.date_created,
    'ready_to_ship',
    'printed',
    'date_created'
  );

  // 2) EN CAMINO: usar la mejor fecha de “shipped/in_transit/out_for_delivery”
  const shippedAt =
      sh.status_history?.date_shipped ||
      sh.date_shipped ||
      sh.status_history?.date_in_transit ||
      sh.date_in_transit ||
      sh.status_history?.date_handling ||
      sh.date_handling;
  if (shippedAt) {
    // substatus “out_for_delivery” para que aparezca el chip
    pushEvent(shippedAt, 'shipped', 'out_for_delivery', 'date_shipped');
  }

  // 3) ENTREGADO (sin substatus)
  const deliveredAt =
      sh.status_history?.date_delivered ||
      sh.date_delivered ||
      sh.date_first_delivered ||
      sh.delivered_date;
  if (deliveredAt) {
    pushEvent(deliveredAt, 'delivered', '', 'date_delivered');
  }

  // 4) NO ENTREGADO / AUSENTE (si existiera)
  const notDeliveredAt =
      sh.status_history?.date_not_delivered ||
      sh.date_not_delivered ||
      sh.first_not_delivered;
  if (notDeliveredAt) {
    pushEvent(notDeliveredAt, 'not_delivered', 'receiver_absent', 'date_not_delivered');
  }

  // orden cronológico + dedupe estable
  out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const seen = new Set();
  const res = [];
  for (const h of out) {
    const k = `${+new Date(h.at)}|${(h.estado_meli.status||'').toLowerCase()}|${(h.estado_meli.substatus||'').toLowerCase()}`;
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

  const RANK = {
    pendiente: 0,
    en_camino: 1,
    no_entregado: 1,
    comprador_ausente: 1,
    reprogramado: 1,
    demorado: 1,
    cancelado: 2,
    entregado: 3,
  };
  function stronger(a, b) {
    const ra = RANK[a] ?? -1;
    const rb = RANK[b] ?? -1;
    return ra >= rb ? a : b;
  }

  const internoNuevo = mapToInterno(stFinal, subFinal);
  const internoPrev  = current?.estado || 'pendiente';
  const internoFuerte = stronger(internoNuevo, internoPrev);

  update.$set.estado = internoFuerte;
  update.$set.estado_meli = {
    status: stFinal,
    substatus: subFinal,
    updatedAt: dateFinal,
  };

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = {
  ensureMeliHistory,
  'meliHistory.v3-sintetiza-desde-shipment': true
};
