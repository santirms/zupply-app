// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function dlog(...a){ if (DEBUG) console.log('[meli-history]', ...a); }

/** Clave estable de dedupe usando SIEMPRE señales MeLi */
function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  return `${ts}|${mst}|${mss}`;
}

/** Mapea items crudos de MeLi a nuestro historial */
function mapHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(e => {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();

    // Espejar substatus cuando no llega y el status ya es informativo
    if (!sub && [
      'ready_to_print', 'printed', 'out_for_delivery', 'not_visited',
      'ready_to_ship', 'handling', 'shipped'
    ].includes(st)) {
      sub = st;
    }

    const at = e?.date ? new Date(e.date) : new Date();

    return {
      at,
      estado: e?.status || '',                // guardamos crudo para historial
      estado_meli: { status: e?.status || '', substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history',
    };
  });
}

/** Mapea (status, substatus) de MeLi a nuestro estado interno */
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

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

/**
 * Hidrata historial de un envío desde la API de MeLi.
 * - TTL salvo force=true
 * - Dedupe por (timestamp,status,substatus) de MeLi
 * - Actualiza estado interno con el último evento
 * - Modo DEBUG con trazas y fallback a /shipments/{id} si history viene vacío
 */
async function ensureMeliHistory(envioOrId, { token, force = false } = {}) {
  const envio = typeof envioOrId === 'string'
    ? await Envio.findById(envioOrId).lean()
    : (envioOrId?.toObject ? envioOrId.toObject() : envioOrId);

  if (!envio?.meli_id) {
    dlog('skip: envio sin meli_id', envio?._id?.toString?.());
    return;
  }

  const last  = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;

  if (!force && fresh && !pobre) {
    dlog('fresh & no pobre → skip', { envio: envio._id?.toString?.(), lastSync: envio.meli_history_last_sync });
    return;
  }

  // Token MeLi
  let access = token;
  if (!access) {
    const cliente = await Cliente.findById(envio.cliente_id).lean();
    if (!cliente?.user_id) {
      dlog('skip: cliente sin user_id MeLi', envio.cliente_id?.toString?.());
      return;
    }
    access = await getValidToken(cliente.user_id);
    if (!access) {
      dlog('skip: no se obtuvo access token válido');
      return;
    }
  }

  // --- Llamada a /history
  let data;
  let statusCode = 0;
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/shipments/${envio.meli_id}/history`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000,
        validateStatus: s => s >= 200 && s < 500,
      }
    );
    statusCode = res.status;
    data = res?.data ?? [];
  } catch (e) {
    dlog('error network/history', e?.message);
    return;
  }

  if (statusCode >= 400) {
    dlog('history non-2xx', { meli_id: envio.meli_id, statusCode });
    return;
  }

  // Shape tolerante
  const rawCandidate = Array.isArray(data)
    ? data
    : (data?.results ?? data?.history ?? data?.entries ?? data?.events);
  const raw = Array.isArray(rawCandidate) ? rawCandidate : [];

  if (DEBUG) {
    dlog('history shape', {
      meli_id: envio.meli_id,
      keys: data && typeof data === 'object' ? Object.keys(data) : 'array',
      count: Array.isArray(raw) ? raw.length : 0
    });
  }

  // --- Fallback de diagnóstico: si no vino historia, obtener el shipment actual
  if (!raw.length && DEBUG) {
    try {
      const r2 = await axios.get(
        `https://api.mercadolibre.com/shipments/${envio.meli_id}`,
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 10000,
          validateStatus: s => s >= 200 && s < 500,
        }
      );
      if (r2.status < 400) {
        const sh = r2.data || {};
        dlog('shipment fallback', {
          id: sh?.id,
          tracking_number: sh?.tracking_number,
          status: sh?.status,
          substatus: sh?.substatus,
          logistic_type: sh?.logistic_type
        });
        // Nota: si acá vemos status/substatus válidos pero /history vacío,
        // suele ser (a) ID no es el shipment correcto (tracking vs shipment),
        // (b) carrier/flujo que no expone historial, o (c) el shipment es muy reciente.
      } else {
        dlog('shipment fallback non-2xx', { code: r2.status });
      }
    } catch (e) {
      dlog('shipment fallback error', e?.message);
    }
  }

  const mapped = mapHistory(raw);

  // Traer historial actual y dedupe
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const currentArr = Array.isArray(current) ? current : [];
  const seen = new Set(currentArr.map(keyOf));
  const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));

  const lastEvt = (Array.isArray(mapped) ? mapped : [])
    .slice()
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0];

  if (DEBUG) {
    dlog('mapped', { toAdd: toAdd.length, lastEvt: lastEvt ? {
      at: lastEvt.at, status: lastEvt?.estado_meli?.status, sub: lastEvt?.estado_meli?.substatus
    } : null });
  }

  const update = { $set: { meli_history_last_sync: new Date() } };
  if (toAdd.length) update.$push = { historial: { $each: toAdd } };

  if (lastEvt) {
    const st  = lastEvt?.estado_meli?.status || lastEvt?.estado || '';
    const sub = lastEvt?.estado_meli?.substatus || '';
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt.at };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
