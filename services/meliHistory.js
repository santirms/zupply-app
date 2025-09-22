// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

// ---------------- utils de clave/fecha ----------------
function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  return `${ts}|${mst}|${mss}`;
}

function toDateOrNull(v) {
  if (!v) return null;
  try {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') return new Date(v);
    if (typeof v === 'object' && v.date) return new Date(v.date);
  } catch {}
  return null;
}

// Extrae la mejor fecha posible de muchas variantes
function bestDate(obj = {}) {
  const tryList = [
    obj.date,
    obj.date_history,
    obj.last_updated,
    obj.updated,
    obj.modification_date,
    obj.status_date,
    obj.statusDate,
    obj.shipping_date,
    obj.created_at,
    obj.creation_date,
    obj.date_created
  ];

  // si date_history es objeto con {date: ...}
  if (!tryList[0] && obj?.date_history && typeof obj.date_history === 'object') {
    const dh = obj.date_history;
    // puede ser {date: "..."} o array [{date, status}...]
    if (Array.isArray(dh) && dh.length) {
      // elegimos la última que tenga date
      const last = [...dh].reverse().find(x => x?.date);
      if (last?.date) tryList.unshift(last.date);
    } else if (dh.date) {
      tryList.unshift(dh.date);
    }
  }

  for (const cand of tryList) {
    const dt = toDateOrNull(cand);
    if (dt && !isNaN(+dt)) return dt;
  }
  return null;
}

// ---------------- mapeos ----------------
function mapHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(e => {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();
    if (!sub && [
      'ready_to_print','printed','out_for_delivery','not_visited',
      'ready_to_ship','handling','shipped'
    ].includes(st)) sub = st;

    const at = bestDate(e) || new Date();
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
  if (s === 'cancelled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}

// ---------------- clientes MeLi ----------------
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

// Convierte la respuesta de /history en array de eventos
function coerceHistoryArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  // campos tipo array conocidos
  const arrays = ['results','history','entries','events'];
  for (const k of arrays) {
    if (Array.isArray(data[k])) return data[k];
  }

  // Si viene objeto con status/substatus/fecha → 1 evento
  if (data.status || data.substatus || data.date || data.date_history || data.status_date || data.last_updated) {
    const out = [];

    // A veces date_history es array de {status, substatus, date}
    if (Array.isArray(data.date_history) && data.date_history.length) {
      for (const h of data.date_history) {
        if (h?.status || h?.substatus || h?.date) {
          out.push({
            status: h.status || data.status || '',
            substatus: h.substatus || data.substatus || '',
            date: h.date || data.date || data.status_date || data.last_updated
          });
        }
      }
      if (out.length) return out;
    }

    // o date_history es objeto {date: ...}
    let date =
      data.date ||
      (data.date_history && (data.date_history.date || data.date_history)) ||
      data.status_date ||
      data.last_updated ||
      data.updated ||
      data.modification_date;

    out.push({
      status: data.status || '',
      substatus: data.substatus || '',
      date
    });
    return out;
  }

  return [];
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
    const data = r.data ?? null;
    return coerceHistoryArray(data);
  } catch { return []; }
}

// ---------------- main ----------------
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

  // 1) Intento directo con lo que hay en meli_id
  let sh = await getShipment(access, envio.meli_id);
  let shipmentId = envio.meli_id;

  if (sh?.id) {
    if (`${sh.id}` !== `${envio.meli_id}`) {
      dlog('autocorrect meli_id', { before: envio.meli_id, after: sh.id });
      shipmentId = `${sh.id}`;
      await Envio.updateOne({ _id: envio._id }, { $set: { meli_id: shipmentId } });
    }
  } else {
    // 2) Resolver desde order si existe
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

  // 3) Historial (array) con shipmentId corregido
  let raw = await getHistory(access, shipmentId);

  // 3.bis) Si sigue vacío pero el shipment trae status, sintetizamos 1 evento
  if ((!raw || raw.length === 0) && sh?.status) {
    const when = bestDate(sh) || new Date();
    raw = [{
      status: sh.status,
      substatus: sh.substatus || '',
      date: when
    }];
    dlog('history vacío: sintetizo 1 evento desde shipment.status', { shipmentId, status: sh.status, substatus: sh.substatus, when });
  }

  const mapped = mapHistory(raw);

  // Mezcla con historial actual y dedupe
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const currentArr = Array.isArray(current) ? current : [];

  const update = { $set: { meli_history_last_sync: new Date() } };

  if (rebuild) {
    // conservar NO-MeLi (panel, scan, asignaciones, etc.)
    const nonMeli = currentArr.filter(h => h?.actor_name !== 'MeLi' && h?.source !== 'meli-history');
    const merged = [...nonMeli, ...mapped];

    // dedupe estable por fecha+status+sub+source
    const seen = new Set();
    const deduped = [];
    merged
      .slice()
      .sort((a,b) => new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0))
      .forEach(h => {
        const k = `${+new Date(h.at || h.updatedAt || 0)}|${(h?.estado_meli?.status||'').toLowerCase()}|${(h?.estado_meli?.substatus||'').toLowerCase()}|${h?.source||''}`;
        if (!seen.has(k)) { seen.add(k); deduped.push(h); }
      });
    update.$set.historial = deduped;
  } else {
    // incremental
    const seen = new Set(currentArr.map(keyOf));
    const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));
    if (toAdd.length) update.$push = { historial: { $each: toAdd } };
  }

  // Último evento (o estado del shipment)
  const lastEvt = (Array.isArray(mapped) ? mapped : [])
    .slice()
    .sort((a,b) => new Date(b.at) - new Date(a.at))[0];

  if (lastEvt || sh?.status) {
    const st  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || '').toString();
    const sub = (lastEvt?.estado_meli?.substatus || sh?.substatus || '').toString();
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt?.at || bestDate(sh) || new Date() };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
