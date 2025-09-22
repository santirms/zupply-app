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
    const url = `https://api.mercadolibre.com/shipments/${idOrTracking}`;
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${access}` },
      timeout: 10000,
      validateStatus: s => s >= 200 && s < 500,
    });
    if (r.status >= 400) { dlog('getShipment http', r.status, idOrTracking); return null; }
    const sh = r.data || null;
    if (sh) dlog('shipment', { id: sh.id, status: sh.status, substatus: sh.substatus, logistic_type: sh.logistic_type });
    return sh;
  } catch (e) { dlog('getShipment err', e?.message); return null; }
}

async function getHistory(access, shipmentId) {
  try {
    const url = `https://api.mercadolibre.com/shipments/${shipmentId}/history`;
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${access}` },
      timeout: 10000,
      validateStatus: s => s >= 200 && s < 500,
    });
    if (r.status >= 400) { dlog('getHistory http', r.status, shipmentId); return []; }
    const data = r.data ?? [];

    // 👇 acepta varias formas conocidas
    let raw = Array.isArray(data)
      ? data
      : (data.results ?? data.history ?? data.entries ?? data.events ?? data.timeline ?? []);

    if (!Array.isArray(raw)) raw = [];
    dlog('history.len', shipmentId, raw.length);
    if (DEBUG && !raw.length) dlog('history.body', JSON.stringify(data).slice(0, 500)); // 1er tramo p/inspección
    return raw;
  } catch (e) { dlog('getHistory err', e?.message); return []; }
}

/**
 * Hidrata historial y AUTOCORRIGE meli_id si estaba guardado el "tracking".
 */
async function ensureMeliHistory(envioOrId, { token, force = false, rebuild = false } = {}) {
  const envio = typeof envioOrId === 'string'
    ? await Envio.findById(envioOrId).lean()
    : (envioOrId?.toObject ? envioOrId.toObject() : envioOrId);

  if (!envio?.meli_id) { dlog('skip sin meli_id', envio?._id?.toString?.()); return; }

    if (!raw.length) {
  dlog('no-history', { envio: envio._id?.toString?.(), shipmentId, meli_id: envio.meli_id, order: envio.venta_id_meli || envio.order_id_meli || envio.order_id || null });
 }

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
    // Respuesta típica: { results: [{ id: <shipmentId>, ... }, ...] } o array
    const data = r.data || {};
    const arr = Array.isArray(data) ? data : (data.results || []);
    return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
  } catch { return null; }
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
  const orderId = envio.venta_id_meli || envio.order_id_meli || envio.order_id; // ajustá al nombre real del campo
  if (orderId) {
    const resolved = await getShipmentFromOrder(access, orderId);
    if (resolved) {
      dlog('autocorrect meli_id via order', { orderId, shipmentId: resolved });
      shipmentId = `${resolved}`;
      await Envio.updateOne({ _id: envio._id }, { $set: { meli_id: shipmentId } });
      // y ahora sí, traemos el shipment real
      sh = await getShipment(access, shipmentId);
    } else {
      dlog('order→shipment no resolvió', { orderId });
    }
  } else {
    dlog('no orderId para resolver shipment');
  }
}

  // 2) Historial con shipmentId corregido
  let raw = await getHistory(access, shipmentId);

  // 2.bis) Retry: si sigue vacío y getShipment trajo status/substatus, al menos actualizamos estado actual
  if (!raw.length && sh?.status) {
    dlog('history vacío, actualizo estado con shipment.status como mínimo');
  }

  const mapped = mapHistory(raw);

  // Mezcla con historial actual y dedupe
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const currentArr = Array.isArray(current) ? current : [];
 
  let update = { $set: { meli_history_last_sync: new Date() } };
  
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
    // camino actual (incremental)
    const seen = new Set(currentArr.map(keyOf));
    const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));
    if (toAdd.length) update.$push = { historial: { $each: toAdd } };
  }

  // Último evento (si hay)
    // Último evento (si hay) o, en su defecto, status del shipment
  const lastEvt = (Array.isArray(mapped) ? mapped : [])
    .slice()
    .sort((a,b) => new Date(b.at) - new Date(a.at))[0];

  // Si hubo eventos usamos el último; si no, pero el shipment trae status, usamos eso
  if (lastEvt || sh?.status) {
    const st  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || '').toString();
    const sub = (lastEvt?.estado_meli?.substatus || sh?.substatus || '').toString();
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt?.at || new Date() };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
