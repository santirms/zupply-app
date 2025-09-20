// services/meliHistory.js
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const HYDRATE_TTL_MIN = 15;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Clave estable para deduplicar eventos usando SIEMPRE las señales de MeLi.
 * (Evita mezclar estado interno "en_camino" con externo "shipped").
 */
function keyOf(h) {
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const mst = (h?.estado_meli?.status || '').toLowerCase();
  const mss = (h?.estado_meli?.substatus || '').toLowerCase();
  return `${ts}|${mst}|${mss}`;
}

/**
 * Mapea el array crudo de MeLi a nuestro formato interno de historial.
 * Añade defaults defensivos y completa substatus cuando viene vacío
 * en estados comunes.
 */
function mapHistory(items = []) {
  return (Array.isArray(items) ? items : []).map(e => {
    const st  = (e?.status || '').toLowerCase();
    let sub   = (e?.substatus || '').toLowerCase();

    // Espejar substatus cuando no llega y el status ya es suficientemente informativo
    if (!sub && [
      'ready_to_print', 'printed', 'out_for_delivery', 'not_visited',
      'ready_to_ship', 'handling', 'shipped'
    ].includes(st)) {
      sub = st;
    }

    const at = e?.date ? new Date(e.date) : new Date();

    return {
      at,
      estado: e?.status || '', // Conservamos crudo como "estado" histórico
      estado_meli: { status: e?.status || '', substatus: sub },
      actor_name: 'MeLi',
      source: 'meli-history',
    };
  });
}

/**
 * Mapea (status, substatus) de MeLi a nuestro estado interno.
 */
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
 * Asegura (hidrata) el historial de un envío desde la API de MeLi.
 * - Respeta un TTL salvo que se pase force=true
 * - Deduplica por (timestamp,status,substatus) de MeLi
 * - Actualiza estado/estado_meli según el último evento
 */
async function ensureMeliHistory(envioOrId, { token, force = false } = {}) {
  // Normalizar 'envio'
  const envio = typeof envioOrId === 'string'
    ? await Envio.findById(envioOrId).lean()
    : (envioOrId?.toObject ? envioOrId.toObject() : envioOrId);

  if (!envio?.meli_id) return;

  // TTL y check de historial "pobre"
  const last  = envio.meli_history_last_sync ? +new Date(envio.meli_history_last_sync) : 0;
  const fresh = Date.now() - last < HYDRATE_TTL_MIN * 60 * 1000;
  const pobre = !Array.isArray(envio.historial) || envio.historial.length < 2;
  if (!force && fresh && !pobre) return;

  // Token MeLi
  let access = token;
  if (!access) {
    const cliente = await Cliente.findById(envio.cliente_id).lean();
    if (!cliente?.user_id) {
      // Sin vínculo MeLi para este cliente; no se puede hidratar
      return;
    }
    access = await getValidToken(cliente.user_id);
    if (!access) return;
  }

  // Llamada a historia MeLi (con try/catch + timeout + validateStatus)
  let data;
  try {
    const res = await axios.get(
      `https://api.mercadolibre.com/shipments/${envio.meli_id}/history`,
      {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 10000, // 10s
        validateStatus: s => s >= 200 && s < 500, // Manejar 4xx sin throw
      }
    );
    if (res.status >= 400) {
      // Autorización inválida / no encontrado / etc.
      return;
    }
    data = res?.data ?? [];
  } catch (_e) {
    // Error de red/timeout/etc. Preferible no romper y salir silenciosamente.
    return;
  }

  // Tolerancia de shape: algunos devuelven array directo; otros usan keys distintas
  const rawCandidate = Array.isArray(data)
    ? data
    : (data?.results ?? data?.history ?? data?.entries ?? data?.events);
  const raw = Array.isArray(rawCandidate) ? rawCandidate : [];

  const mapped = mapHistory(raw);

  // Traer historial actual y deduplicar
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const currentArr = Array.isArray(current) ? current : [];
  const seen = new Set(currentArr.map(keyOf));
  const toAdd = (Array.isArray(mapped) ? mapped : []).filter(h => !seen.has(keyOf(h)));

  // Último evento cronológicamente
  const lastEvt = (Array.isArray(mapped) ? mapped : [])
    .slice()
    .sort((a, b) => new Date(b.at) - new Date(a.at))[0];

  // Armar update
  const update = {
    $set: { meli_history_last_sync: new Date() }
  };

  if (toAdd.length) {
    update.$push = { historial: { $each: toAdd } };
  }

  if (lastEvt) {
    const st  = lastEvt?.estado_meli?.status || lastEvt?.estado || '';
    const sub = lastEvt?.estado_meli?.substatus || '';
    update.$set.estado = mapToInterno(st, sub);
    update.$set.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt.at };
  }

  await Envio.updateOne({ _id: envio._id }, update);
}

module.exports = { ensureMeliHistory };
