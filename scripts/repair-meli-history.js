#!/usr/bin/env node
/* repair-meli-history v2: corrige fechas de delivered, sintetiza ready_to_ship/shipped/delivered
   - no retrocede estados (entregado gana)
   - usa fechas reales de shipment: date_created/date_shipped/date_delivered
   - procesa en lotes con cursor para bajo MEM
*/
const mongoose = require('mongoose');
const axios = require('axios');

const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { getValidToken } = require('../utils/meliUtils');

const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/app';
const DEBUG = process.env.MELI_HISTORY_DEBUG === '1';

function dlog(...a){ if (DEBUG) console.log('[repair]', ...a); }

function mapToInterno(status, substatus) {
  const s = (status || '').toLowerCase();
  const sub = (substatus || '').toLowerCase();
  if (s === 'delivered') return 'entregado';
  if (s === 'cancelled') return 'cancelado';
  if (s === 'not_delivered') return /receiver[_\s-]?absent/.test(sub) ? 'comprador_ausente' : 'no_entregado';
  if (s === 'shipped') return 'en_camino';
  if (s === 'ready_to_ship' || s === 'handling' || s === 'printed') return 'pendiente';
  if (/resched/.test(sub)) return 'reprogramado';
  if (/delay/.test(sub))   return 'demorado';
  return 'pendiente';
}

async function getShipment(access, idOrTracking) {
  try {
    const r = await axios.get(`https://api.mercadolibre.com/shipments/${idOrTracking}`, {
      headers: { Authorization: `Bearer ${access}` },
      timeout: 10000,
      validateStatus: s => s >= 200 && s < 500,
    });
    return r.status >= 400 ? null : (r.data || null);
  } catch { return null; }
}

function sameKey(h){
  const ts  = +new Date(h?.at || h?.updatedAt || 0);
  const st  = (h?.estado_meli?.status || h?.estado || '').toLowerCase();
  const sub = (h?.estado_meli?.substatus || '').toLowerCase();
  const src = (h?.source || '');
  return `${ts}|${st}|${sub}|${src}`;
}

function pushIfMissing(arr, evt){
  const key = sameKey(evt);
  const seen = new Set(arr.map(sameKey));
  if (!seen.has(key)) arr.push(evt);
}

function mkEvt(date, status, substatus){
  if (!date) return null;
  const at = new Date(date);
  const s  = (status || '').toLowerCase();
  let sub  = (substatus || '').toLowerCase();
  if (!sub && ['ready_to_ship','printed','out_for_delivery','handling','shipped','not_visited'].includes(s)) {
    sub = s;
  }
  return {
    at,
    estado: status,
    estado_meli: { status, substatus: sub },
    actor_name: 'MeLi',
    source: 'repair-v2',
  };
}

function strongest(a, b){
  const R = { pendiente:0, en_camino:1, no_entregado:1, comprador_ausente:1, reprogramado:1, demorado:1, cancelado:2, entregado:3 };
  return (R[a] ?? -1) >= (R[b] ?? -1) ? a : b;
}

async function main(){
  await mongoose.connect(MONGO, { maxPoolSize: 5 });
  console.log('[repair] conectado a Mongo');

  // Sólo con meli_id
  const q = { meli_id: { $exists: true, $ne: null, $ne: '' } };

  const cursor = Envio.find(q).select('_id cliente_id meli_id historial estado estado_meli').cursor();

  let seen=0, fixed=0, skipped=0, fails=0;

  for await (const envio of cursor) {
    seen++;
    try {
      const hist = Array.isArray(envio.historial) ? envio.historial.slice() : [];

      // Token por cliente
      let access = null;
      if (envio.cliente_id) {
        const cli = await Cliente.findById(envio.cliente_id).lean();
        if (cli?.user_id) access = await getValidToken(cli.user_id);
      }

      // Shipment (para fechas reales)
      const sh = access ? await getShipment(access, envio.meli_id) : null;

      const dCreated  = sh?.date_created ? new Date(sh.date_created) : null;
      const dShipped  = sh?.date_shipped ? new Date(sh.date_shipped) : null;
      const dDelivered= (sh?.date_delivered || sh?.date_first_delivered) ? new Date(sh.date_delivered || sh.date_first_delivered) : null;

      // armamos trilogía mínima (sin duplicar)
      const tmp = Array.isArray(hist) ? hist.slice() : [];

      if (dCreated)   pushIfMissing(tmp, mkEvt(dCreated,   'ready_to_ship', null));
      if (dShipped)   pushIfMissing(tmp, mkEvt(dShipped,   'shipped',       sh?.substatus || null));
      if (dDelivered) pushIfMissing(tmp, mkEvt(dDelivered, 'delivered',     sh?.substatus || null));

      // si ya había delivered pero con fecha errónea (antes de created/shipped), preferimos dDelivered si existe
      const deliveredExisting = tmp
        .filter(e => (e?.estado_meli?.status || e?.estado || '').toLowerCase() === 'delivered')
        .sort((a,b) => new Date(a.at) - new Date(b.at));

      if (deliveredExisting.length && dDelivered) {
        const firstDel = deliveredExisting[0];
        if (new Date(firstDel.at) < (dCreated || firstDel.at)) {
          // corrige fecha al dDelivered más reciente
          deliveredExisting.forEach(e => { e.at = dDelivered; });
        }
      }

      // Dedup + orden
      const seenKeys = new Set();
      const dedup = [];
      tmp.sort((a,b) => new Date(a.at) - new Date(b.at)).forEach(e => {
        if (!e) return;
        const k = sameKey(e);
        if (!seenKeys.has(k)) { seenKeys.add(k); dedup.push(e); }
      });

      // Estado final fuerte
      const lastEvt = dedup.slice().sort((a,b) => new Date(b.at) - new Date(a.at))[0];
      const stFinal  = (lastEvt?.estado_meli?.status || lastEvt?.estado || envio?.estado_meli?.status || 'ready_to_ship').toString();
      const subFinal = (lastEvt?.estado_meli?.substatus || envio?.estado_meli?.substatus || '').toString();

      const internoNuevo  = mapToInterno(stFinal, subFinal);
      const internoPrev   = envio.estado || 'pendiente';
      const internoFuerte = strongest(internoNuevo, internoPrev);

      // Sólo haces update si cambia algo
      const update = {
        $set: {
          historial: dedup,
          estado: internoFuerte,
          estado_meli: {
            status: stFinal,
            substatus: subFinal,
            updatedAt: lastEvt?.at || dDelivered || dShipped || dCreated || new Date(),
          },
          meli_history_last_sync: new Date(),
        }
      };

      await Envio.updateOne({ _id: envio._id }, update);
      fixed++;
    } catch (e) {
      fails++; dlog('err', envio?._id?.toString?.(), e?.message);
    }

    if (seen % 500 === 0) {
      console.log(`[repair] progreso: seen=${seen} fixed=${fixed} skipped=${skipped} fails=${fails}`);
    }
  }

  console.log(`[repair] listo. vistos=${seen} fixed=${fixed} skipped=${skipped} fails=${fails}`);
  await mongoose.disconnect();
}

main().catch(e => {
  console.error('[repair] FATAL', e);
  process.exit(1);
});
