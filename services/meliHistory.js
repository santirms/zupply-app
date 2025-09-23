// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

// ---------------------------- helpers ----------------------------
function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  const src = (h?.source || '').toLowerCase();
  return `${ts}|${mst}|${mss}|${src}`;
}

function mapHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(e => {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();
    if (!sub && [
      'ready_to_print','printed','out_for_delivery','not_visited',
      'ready_to_ship','handling','shipped'
    ].includes(st)) sub = st;

    const at = e?.date ? new Date(e.date) : new Date();
    return {
      at,
      estado: e?.status || '',
      estado_meli: { status: e?.status || '', substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history',
    };
  });
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

// ---- síntesis cuando /history viene vacío (usa fechas REALES) ----
function buildHistoryFromShipment(sh) {
  if (!sh || typeof sh !== 'object') return [];

  const out = [];

  // 1) Preferimos date_history si existe
  const dh = sh.date_history && typeof sh.date_history === 'object' ? sh.date_history : null;

  // Map semántico de claves -> (status, substatus)
  const KNOWN = [
    // formato: [test, status, substatus]
    [/delivered/, 'delivered', ''],
    [/not[_-]?delivered|receiver[_-]?absent|address[_-]?mismatch/, 'not_delivered', 'receiver_absent'],
    [/out[_-]?for[_-]?delivery/, 'shipped', 'out_for_delivery'],
    [/in[_-]?transit/, 'shipped', ''],
    [/shipped?/, 'shipped', ''],
    [/ready[_-]?to[_-]?print|printed/, 'ready_to_ship', 'printed'],
    [/handling|ready[_-]?to[_-]?ship/, 'ready_to_ship', 'handling'],
    [/cancel(l)?ed?/, 'cancelled', '']
  ];

  const pushEvent = (dateVal, status, substatus, sourceKey) => {
    if (!dateVal) return;
    const dt = new Date(dateVal);
    if (isNaN(+dt)) return;
    out.push({
      at: dt,
      estado: status,
      estado_meli: { status, substatus: substatus || '' },
      actor_name: 'MeLi',
      source: `meli-history:shipment:${sourceKey || 'date_history'}`
    });
  };

  // 1.a) date_history con claves conocidas o “auto-detect”
  if (dh) {
    for (const [k, v] of Object.entries(dh)) {
      if (!v) continue;
      const key = String(k).toLowerCase();
      const val = v && typeof v === 'object' && v.date ? v.date : v; // algunos dh vienen {date: "..."}
      for (const [re, st, sub] of KNOWN) {
        if (re.test(key)) {
          pushEvent(val, st, sub, key);
          break;
        }
      }
    }
  }

  // 2) fallback: escanear campos del shipment con pinta de fecha y estado
  if (!out.length) {
    for (const [k, v] of Object.entries(sh)) {
      if (!v) continue;
      const key = String(k).toLowerCase();
      const looksLikeDate = (x) => {
        if (typeof x === 'string' && x.length >= 10 && /\d{4}-\d{2}-\d{2}/.test(x)) return true;
        return false;
      };
      if (looksLikeDate(v)) {
        for (const [re, st, sub] of KNOWN) {
          if (re.test(key)) { pushEvent(v, st, sub, key); break; }
        }
      }
    }
  }

  // 3) si igual no hay nada y tenemos status actual, ponemos UNO solo con updated_at si existe
  if (!out.length && sh.status) {
    const updated =
      sh.status_history?.date_updated ||
      sh.last_updated ||
      sh.date_last_updated ||
      sh.date_updated ||
      sh.date_delivered || // por si existe
      sh.date_created ||
      new Date();
    const st = String(sh.status).toLowerCase();
    const sub = String(sh.substatus || '').toLowerCase();
    pushEvent(updated, st, sub, 'status_fallback');
  }

  // ordenar y dedupe estable
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
/**
 * Hidrata historial y AUTOCORRIGE meli_id si estaba guardado el "tracking".
 */
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

  // Intento directo con lo que hay en meli_id
  let sh = await getShipment(access, envio.meli_id);
  let shipmentId = envio.meli_id;

  if (sh?.id) {
    if (`${sh.id}` !== `${envio.meli_id}`) {
      dlog('autocorrect meli_id', { before: envio.meli_id, after: sh.id });
      shipmentId = `${sh.id}`;
      await Envio.updateOne({ _id: envio._id }, { $set: { meli_id: shipmentId } });
    }
  } else {
    // Segundo intento: order -> shipment
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

  // Si no vino nada del history, sintetizamos desde shipment con fechas reales
  if (!mapped.length && sh) {
    const synth = buildHistoryFromShipment(sh);
    if (synth.length) {
      dlog('history vacío → sintetizo desde shipment con fechas reales', synth.length);
      mapped = synth;
    }
  }

  // Mezcla con historial actual y dedupe
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const currentArr = Array.isArray(current) ? current : [];

  const update = { $set: { meli_history_last_sync: new Date() } };

  if (rebuild) {
    // 1) conservar NO-MeLi (panel, scan, asignaciones, etc.)
    const nonMeli = currentArr.filter(h => h?.actor_name !== 'MeLi' && h?.source !== 'meli-history' && !(String(h?.source||'').startsWith('meli-history:shipment')));

    // 2) unir con lo nuevo de MeLi
    const merged = [...nonMeli, ...mapped];

    // 2.bis) si ya había un delivered de MeLi y el nuevo tiene otra fecha, preferimos la **más antigua**
    const delivered = merged.filter(h => (h?.estado_meli?.status || '').toLowerCase() === 'delivered');
    if (delivered.length > 1) {
      const oldest = delivered.reduce((m, h) => (+new Date(h.at) < +new Date(m.at) ? h : m));
      // dejamos solo el más antiguo
      const oldestKey = keyOf(oldest);
      for (let i = merged.length - 1; i >= 0; i--) {
        const h = merged[i];
        if ((h?.estado_meli?.status || '').toLowerCase() === 'delivered' && keyOf(h) !== oldestKey) {
          merged.splice(i, 1);
        }
      }
    }

    // 3) dedupe estable por fecha+status+sub+source
    const seen = new Set();
    const deduped = [];
    merged
      .slice()
      .sort((a,b) => new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0))
      .forEach(h => {
        const k = keyOf(h);
        if (!seen.has(k)) { seen.add(k); deduped.push(h); }
      });

    update.$set.historial = deduped;
  } else {
    // incremental
    const seen = new Set(currentArr.map(keyOf));
    const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));
    if (toAdd.length) update.$push = { historial: { $each: toAdd } };
  }

  // Último evento (si hay) o, en su defecto, status del shipment
   // ---------- reemplazar desde acá (final de ensureMeliHistory) ----------
  // Armamos el array "all" con el historial resultante post-merge
  let all;
  if (rebuild) {
    all = update.$set.historial || [];
  } else {
    const curr = Array.isArray(currentArr) ? currentArr : [];
    const add  = (update.$push?.historial?.$each) || [];
    all = [...curr, ...add];
  }

  // Helper de fuerza de estado (no retroceder)
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

  // Último evento por fecha
  const lastEvt = (Array.isArray(all) ? all : [])
    .slice()
    .sort((a, b) => new Date(b.at || b.updatedAt || 0) - new Date(a.at || a.updatedAt || 0))[0];

  // ¿Hay delivered en la línea de tiempo? (con su fecha real)
  const deliveredEvt = (Array.isArray(all) ? all : [])
    .filter(h => (h?.estado_meli?.status || h?.estado || '').toString().toLowerCase() === 'delivered')
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0];

  // Fallback a shipment si no hay eventos
  const fallbackDate =
    (sh && (sh.date_delivered || sh.date_first_delivered)) ? new Date(sh.date_delivered || sh.date_first_delivered)
    : (sh && sh.date_shipped) ? new Date(sh.date_shipped)
    : (sh && sh.date_created) ? new Date(sh.date_created)
    : new Date();

  const stBase  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || envio?.estado_meli?.status || '').toString();
  const subBase = (lastEvt?.estado_meli?.substatus || sh?.substatus || envio?.estado_meli?.substatus || '').toString();

  // Si hay delivered real, preferimos ese estado y esa fecha
  const stFinal  = deliveredEvt ? 'delivered' : stBase;
  const subFinal = deliveredEvt ? (deliveredEvt?.estado_meli?.substatus || '') : subBase;
  const dateFinal = deliveredEvt ? (deliveredEvt.at || fallbackDate) : (lastEvt?.at || fallbackDate);

  // Mapear a interno y NO retroceder
  const internoNuevo = mapToInterno(stFinal, subFinal);
  const internoPrev  = envio?.estado || 'pendiente';
  const internoFuerte = stronger(internoNuevo, internoPrev);

  update.$set.estado = internoFuerte;
  update.$set.estado_meli = {
    status: stFinal,
    substatus: subFinal,
    updatedAt: dateFinal,
  };
  // ---------- reemplazar hasta acá ----------
  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = {
  ensureMeliHistory,
  // versión etiquetada para tus logs:
  'meliHistory.v3-sintetiza-desde-shipment': true
};
