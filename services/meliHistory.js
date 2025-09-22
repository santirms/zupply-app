// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';
function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  return `${ts}|${mst}|${mss}`;
}

function mapHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(e => {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();
    if (!sub && [
      'ready_to_print','printed','out_for_delivery','not_visited',
      'ready_to_ship','handling','shipped'
    ].includes(st)) sub = st;

    // elegir la mejor fecha disponible
    const dateRaw =
      e?.date ||
      e?.date_history ||
      e?.last_updated ||
      e?.updated ||
      e?.modification_date ||
      e?.status_date ||
      null;

    const at = dateRaw ? new Date(dateRaw) : new Date();

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

    // 1) intentar arrays conocidos
    let raw = null;
    if (Array.isArray(data)) raw = data;
    else if (Array.isArray(data?.results)) raw = data.results;
    else if (Array.isArray(data?.history)) raw = data.history;
    else if (Array.isArray(data?.entries)) raw = data.entries;
    else if (Array.isArray(data?.events))  raw = data.events;

    // 2) si no hay arrays pero viene objeto con status/substatus/fecha, lo tratamos como 1 evento
    if (!raw) {
      if (data && (data.status || data.substatus || data.date_history || data.date || data.status_date || data.last_updated)) {
        raw = [data];
      } else {
        raw = [];
      }
    }
    return raw;
  } catch { return []; }
}

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
    // 2) Segundo intento: si tenemos order_id (venta_id_meli), resolver shipment desde la orden
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

  // 3) Historial con shipmentId corregido
  let raw = await getHistory(access, shipmentId);

  // 3.bis) Si sigue vacío pero el shipment trae status, sintetizamos 1 evento
  if ((!raw || raw.length === 0) && sh?.status) {
    const when =
      sh?.date_history ||
      sh?.last_updated ||
      sh?.status_date ||
      sh?.date ||
      sh?.updated ||
      new Date().toISOString();

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
    // 1) conservar NO-MeLi (panel, scan, asignaciones, etc.)
    const nonMeli = currentArr.filter(h => h?.actor_name !== 'MeLi' && h?.source !== 'meli-history');

    // 2) unir con lo nuevo de MeLi
    const merged = [...nonMeli, ...mapped];

    // 3) dedupe estable por fecha+status+sub+source
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
    // camino incremental
    const seen = new Set(currentArr.map(keyOf));
    const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));
    if (toAdd.length) update.$push = { historial: { $each: toAdd } };
  }

  // Último evento (si hay) o, en su defecto, status del shipment
  const lastEvt = (Array.isArray(mapped) ? mapped : [])
    .slice()
    .sort((a,b) => new Date(b.at) - new Date(a.at))[0];

  if (lastEvt || sh?.status) {
    const st  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || '').toString();
    const sub = (lastEvt?.estado_meli?.substatus || sh?.substatus || '').toString();
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt?.at || new Date() };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
