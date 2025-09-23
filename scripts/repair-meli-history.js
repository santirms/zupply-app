// scripts/repair-meli-history.js
/* eslint-disable no-console */
const mongoose = require('mongoose');
const axios = require('axios');

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

// ---------- Config ----------
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('[repair] ERROR: faltan MONGO_URI/MONGODB_URI');
  process.exit(1);
}

// Flags simples
const argv = process.argv.slice(2);
const DRY  = argv.includes('--dry');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? (argv[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null;
})();
const CHUNK = Number((() => {
  const i = argv.indexOf('--chunk');
  return i >= 0 ? argv[i + 1] : 500;
})());

// ---------- Helpers ----------
function asDate(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(+d) ? d : null;
}

function safeLower(s) { return (s || '').toString().toLowerCase(); }

function mapToInterno(status, substatus) {
  const s = safeLower(status);
  const sub = safeLower(substatus);
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}

function dedupeAndSort(merged) {
  const seen = new Set();
  const out = [];
  merged
    .slice()
    .sort((a,b) => new Date(a.at || a.updatedAt || 0) - new Date(b.at || b.updatedAt || 0))
    .forEach(h => {
      const k = `${+new Date(h.at || h.updatedAt || 0)}|${safeLower(h?.estado_meli?.status)}|${safeLower(h?.estado_meli?.substatus)}|${h?.source||''}`;
      if (!seen.has(k)) { seen.add(k); out.push(h); }
    });
  return out;
}

async function getShipment(access, idOrTracking) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/shipments/${idOrTracking}`,
      { headers: { Authorization: `Bearer ${access}` }, timeout: 10000, validateStatus: s => s >= 200 && s < 500 }
    );
    return r.status >= 400 ? null : (r.data || null);
  } catch { return null; }
}

async function getHistory(access, shipmentId) {
  try {
    const r = await axios.get(
      `https://api.mercadolibre.com/shipments/${shipmentId}/history`,
      { headers: { Authorization: `Bearer ${access}` }, timeout: 10000, validateStatus: s => s >= 200 && s < 500 }
    );
    if (r.status >= 400) return [];
    const data = r.data ?? [];
    const raw = Array.isArray(data) ? data : (data.results ?? data.history ?? data.entries ?? data.events ?? []);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function mapHistoryFromMeliEvents(events = []) {
  // events: [{ date, status, substatus }]
  return (Array.isArray(events) ? events : [])
    .map(e => {
      const st  = e?.status || '';
      let sub   = e?.substatus || '';
      const stL = safeLower(st);
      const subL = safeLower(sub);
      let subFixed = subL;
      if (!subFixed && ['ready_to_print','printed','out_for_delivery','not_visited','ready_to_ship','handling','shipped'].includes(stL)) {
        subFixed = stL;
      }
      const at = asDate(e?.date) || new Date(0); // si falta date, que quede al principio
      return {
        at,
        estado: st,
        estado_meli: { status: st, substatus: subFixed },
        actor_name: 'MeLi',
        source: 'meli-history',
      };
    })
    .filter(x => x.at && !isNaN(+x.at));
}

function mapFromShipmentDateHistory(sh) {
  // sh.date_history puede venir como:
  // { shipped: "2025-09-09T16:31:12.578Z", delivered: "2025-09-09T22:21:11.110Z", ... }
  const dh = sh?.date_history || sh?.dates || null;
  if (!dh || typeof dh !== 'object') return [];
  const pairs = Object.entries(dh)
    .filter(([k,v]) => v && asDate(v))
    .map(([k,v]) => ({ status: k, substatus: null, date: v }));

  return mapHistoryFromMeliEvents(pairs);
}

// ---------- Core ----------
async function repairOne(envio) {
  // 1) Token
  const cliente = await Cliente.findById(envio.cliente_id).lean();
  if (!cliente?.user_id) return { changed: false, reason: 'no-user' };
  const access = await getValidToken(cliente.user_id);
  if (!access) return { changed: false, reason: 'no-token' };

  // 2) Datos remotos
  const sh   = await getShipment(access, envio.meli_id);
  const hist = await getHistory(access, envio.meli_id);

  // 3) Seleccionar fuente
  let meliEvents = mapHistoryFromMeliEvents(hist);
  if (!meliEvents.length && sh) {
    // history vacío → sintetizamos con date_history
    meliEvents = mapFromShipmentDateHistory(sh);
  }

  // 4) Si igual no tenemos nada, al menos fijamos el estado actual con la fecha más razonable
  if (!meliEvents.length && sh?.status) {
    const lastDate =
      asDate(sh?.date_delivered) ||
      asDate(sh?.date_shipped) ||
      asDate(sh?.date_created) ||
      new Date(); // fallback
    meliEvents = [{
      at: lastDate,
      estado: sh.status,
      estado_meli: { status: sh.status, substatus: sh.substatus || null },
      actor_name: 'MeLi',
      source: 'meli-history',
    }];
  }

  // 5) Mezcla + dedupe preservando NO-MeLi
  const current = (await Envio.findById(envio._id).select('historial').lean())?.historial || [];
  const nonMeli = (Array.isArray(current) ? current : []).filter(h => h?.actor_name !== 'MeLi' && h?.source !== 'meli-history');

  // ↳ también limpiamos entregas “nuevas” con fecha incorrecta (ahora) si existe delivered con fecha real
  const nowishCutoffMs = Date.now() - 1000 * 60 * 60 * 24; // 24h
  const currentMeli = (Array.isArray(current) ? current : []).filter(h => h?.actor_name === 'MeLi' || h?.source === 'meli-history');
  const suspicious = currentMeli.filter(h =>
    safeLower(h?.estado_meli?.status) === 'delivered' &&
    (!h.at || (+new Date(h.at) > nowishCutoffMs)) // fecha reciente sospechosa
  );
  let cleanedCurrentMeli = currentMeli;
  if (meliEvents.some(e => safeLower(e.estado_meli?.status) === 'delivered')) {
    // si tenemos delivered “real”, descartamos los sospechosos
    const setSusp = new Set(suspicious.map(h => `${+new Date(h.at||0)}|${safeLower(h?.estado_meli?.status)}|${safeLower(h?.estado_meli?.substatus)}|${h?.source||''}`));
    cleanedCurrentMeli = currentMeli.filter(h => {
      const k = `${+new Date(h.at||0)}|${safeLower(h?.estado_meli?.status)}|${safeLower(h?.estado_meli?.substatus)}|${h?.source||''}`;
      return !setSusp.has(k);
    });
  }

  const merged = [...nonMeli, ...cleanedCurrentMeli, ...meliEvents];
  const deduped = dedupeAndSort(merged);

  // 6) Último evento real para estado/estado_meli
  const lastEvt = deduped
    .slice()
    .sort((a,b) => new Date(b.at || 0) - new Date(a.at || 0))[0];

  const newSet = {
    historial: deduped,
    meli_history_last_sync: new Date(),
  };

  if (lastEvt) {
    const st  = (lastEvt?.estado_meli?.status || lastEvt?.estado || sh?.status || '').toString();
    const sub = (lastEvt?.estado_meli?.substatus || sh?.substatus || '').toString();
    newSet.estado = mapToInterno(st, sub);
    newSet.estado_meli = { status: st, substatus: sub, updatedAt: lastEvt.at || new Date() };
  }

  // 7) Persistir si cambió
  const changed =
    JSON.stringify(current) !== JSON.stringify(deduped) ||
    safeLower(envio?.estado_meli?.status) !== safeLower(newSet?.estado_meli?.status) ||
    +new Date(envio?.estado_meli?.updatedAt || 0) !== +new Date(newSet?.estado_meli?.updatedAt || 0) ||
    (envio?.estado !== newSet?.estado);

  if (!changed) return { changed: false, reason: 'no-change' };

  if (!DRY) {
    await Envio.updateOne({ _id: envio._id }, { $set: newSet });
  }
  return { changed: true };
}

// ---------- Main ----------
(async function main() {
  await mongoose.connect(MONGO_URI, { maxPoolSize: 10 });
  console.log('[repair] conectado a Mongo');

  const baseQuery = { meli_id: { $exists: true, $ne: null } };
  if (ONLY && ONLY.length) baseQuery._id = { $in: ONLY };

  const total = await Envio.countDocuments(baseQuery);
  console.log(`[repair] total con meli_id: ${total}`);

  let seen = 0, fixed = 0, skipped = 0, fails = 0;

  // stream en chunks
  let cursor = Envio.find(baseQuery).select('_id cliente_id meli_id estado estado_meli historial').lean().cursor();

  const batch = [];
  for await (const envio of cursor) {
    batch.push(envio);
    if (batch.length >= CHUNK) {
      await Promise.all(batch.map(async e => {
        try {
          const res = await repairOne(e);
          seen++;
          if (res.changed) fixed++; else skipped++;
        } catch (err) {
          fails++; seen++;
          console.error('[repair] fallo', e?._id?.toString?.(), err?.message);
        }
      }));
      batch.length = 0;
      console.log(`[repair] progreso: seen=${seen} fixed=${fixed} skipped=${skipped} fails=${fails}`);
    }
  }
  // flush final
  if (batch.length) {
    await Promise.all(batch.map(async e => {
      try {
        const res = await repairOne(e);
        seen++;
        if (res.changed) fixed++; else skipped++;
      } catch (err) {
        fails++; seen++;
        console.error('[repair] fallo', e?._id?.toString?.(), err?.message);
      }
    }));
  }

  console.log(`[repair] listo. vistos=${seen} fixed=${fixed} skipped=${skipped} fails=${fails} ${DRY ? '(dry-run)' : ''}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(async e => {
  console.error('[repair] FATAL:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
