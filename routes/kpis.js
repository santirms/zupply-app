// routes/kpis.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

function dateFromPartsLocal(dayISO, hhmm = '13:00'){
  const [H='13', m='00'] = String(hhmm).split(':');
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}
function buildCutWindowForToday(hora_corte_str){
  const hoyISO = new Date().toISOString().slice(0,10);
  const ayerISO = new Date(Date.now()-24*60*60*1000).toISOString().slice(0,10);
  return {
    start: dateFromPartsLocal(ayerISO, hora_corte_str||'13:00'),
    end:   dateFromPartsLocal(hoyISO,  hora_corte_str||'13:00'),
  };
}
const isEnRuta     = (e) => ['asignado','en_camino'].includes((e.estado||'').toLowerCase());
const isEntregado  = (e) => (e.estado||'').toLowerCase()==='entregado' || (e.estado_meli?.status||'').toLowerCase()==='delivered';
const isCancelado  = (e) => (e.estado||'').toLowerCase()==='cancelado';

async function kpisDiaHandler(req,res){
  try{
    // --- Ventanas por cliente (para PENDIENTES) ---
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
    const autoIds=[], manualIds=[], ventanas=new Map();
    for(const c of clientes){
      const id = String(c._id);
      if (c.auto_ingesta){ autoIds.push(id); ventanas.set(id, buildCutWindowForToday(c.hora_corte||'13:00')); }
      else manualIds.push(id);
    }

    // Manuales: hoy calendario
    const hoyISO = new Date().toISOString().slice(0,10);
    const hoyStart = dateFromPartsLocal(hoyISO, '00:00');
    const hoyEnd   = dateFromPartsLocal(hoyISO, '23:59');

    const [candAuto, candManual] = await Promise.all([
      autoIds.length   ? Envio.find({ cliente_id: { $in: autoIds } }).lean() : [],
      manualIds.length ? Envio.find({ cliente_id: { $in: manualIds }, fecha: { $gte: hoyStart, $lte: hoyEnd } }).lean() : []
    ]);

    // aplicar ventana por CORTE a los auto_ingesta
    const enHoyPorCorte = candAuto.filter(e=>{
      const v = ventanas.get(String(e.cliente_id)); if(!v) return false;
      const f = new Date(e.fecha); return f>=v.start && f<v.end;
    }).concat(candManual);

    // === KPIs ===
    // Pendientes (definición por corte)
    const pendientes = enHoyPorCorte.filter(e => !isEntregado(e) && !isCancelado(e)).length;

    // En ruta (si lo querés por corte)
    const en_ruta = enHoyPorCorte.filter(isEnRuta).length;

    // Entregados **HOY calendario (resetea 00:00)**
    const entregadosHoyDocs = await Envio.find(
      { fecha: { $gte: hoyStart, $lte: hoyEnd } },
      'estado estado_meli'
    ).lean();
    const entregados = entregadosHoyDocs.filter(isEntregado).length;

    // Incidencias (36h) incluyendo substatus de MeLi (resched/delay) y sin chofer
// --- dentro de kpisDiaHandler, reemplazá el bloque de incidencias ---
const win36Start = new Date(Date.now() - 36*60*60*1000);

// Traemos lo justo y necesario
const ult36h = await Envio.find(
  { fecha: { $gte: win36Start } },
  'estado estado_meli historial notas chofer'
).lean();

const norm = s => (s || '').toString().toLowerCase();

let inc_notes = 0, inc_reprog = 0, inc_cancel = 0, inc_sinChofer = 0, inc_patron = 0;

const incidencias = ult36h.filter(e => {
  const estado    = norm(e.estado);
  const emStatus  = norm(e.estado_meli?.status);
  const emSub     = norm(e.estado_meli?.substatus);

  // ⚠️ Excluir RESUELTOS
  if (estado === 'entregado' || emStatus === 'delivered') return false;

  // A) Con notas (al menos 1)
  const hasNotes = Array.isArray(e.notas) && e.notas.length > 0;

  // B) Reprogramados (por estado ó por substatus de MeLi)
  const isReprog =
    estado === 'reprogramado' ||
    /resched/.test(emSub) || emSub === 'buyer_rescheduled';

  // C) Cancelados (por estado ó status de MeLi)
  const isCancel =
    estado === 'cancelado' || emStatus === 'cancelled' || emStatus === 'canceled';

  // D) Sin chofer asignado (solo cuenta si no está entregado/cancelado)
  const sinChofer =
    !e.chofer &&
    !isCancel &&
    !isReprog;

  // E) Patrón En camino -> Reprogramado -> En camino en historial
  let patron = false;
  if (Array.isArray(e.historial) && e.historial.length >= 3) {
    const joined = e.historial.map(h => norm(h.estado)).join('|');
    patron = /en_camino\|reprogramado\|en_camino/.test(joined);
  }

  // contadores para debug
  if (hasNotes) inc_notes++;
  if (isReprog) inc_reprog++;
  if (isCancel) inc_cancel++;
  if (sinChofer) inc_sinChofer++;
  if (patron) inc_patron++;

  return hasNotes || isReprog || isCancel || sinChofer || patron;
}).length;

res.json({ pendientes, en_ruta, entregados, incidencias });
  } catch(e){
    console.error('KPIs /home error', e);
    res.status(500).json({ error:'server_error' });
  }
  }
// Debug: ver desglose de incidencias
router.get('/home/debug', async (req, res) => {
  try {
    const win36Start = new Date(Date.now() - 36*60*60*1000);
    const ult36h = await Envio.find(
      { fecha: { $gte: win36Start } },
      'estado estado_meli historial notas chofer'
    ).lean();

    const norm = s => (s || '').toString().toLowerCase();
    let inc_notes = 0, inc_reprog = 0, inc_cancel = 0, inc_sinChofer = 0, inc_patron = 0, total = 0;

    ult36h.forEach(e => {
      const estado    = norm(e.estado);
      const emStatus  = norm(e.estado_meli?.status);
      const emSub     = norm(e.estado_meli?.substatus);

      if (estado === 'entregado' || emStatus === 'delivered') return;

      const hasNotes = Array.isArray(e.notas) && e.notas.length > 0;
      const isReprog = estado === 'reprogramado' || /resched/.test(emSub) || emSub === 'buyer_rescheduled';
      const isCancel = estado === 'cancelado' || emStatus === 'cancelled' || emStatus === 'canceled';
      const sinChofer = !e.chofer && !isCancel && !isReprog;

      let patron = false;
      if (Array.isArray(e.historial) && e.historial.length >= 3) {
        const joined = e.historial.map(h => norm(h.estado)).join('|');
        patron = /en_camino\|reprogramado\|en_camino/.test(joined);
      }

      const hit = hasNotes || isReprog || isCancel || sinChofer || patron;
      if (hit) {
        total++;
        if (hasNotes) inc_notes++;
        if (isReprog) inc_reprog++;
        if (isCancel) inc_cancel++;
        if (sinChofer) inc_sinChofer++;
        if (patron) inc_patron++;
      }
    });

    res.json({
      ventana_desde: win36Start,
      total,
      desglose: {
        con_notas: inc_notes,
        reprogramados: inc_reprog,
        cancelados: inc_cancel,
        sin_chofer: inc_sinChofer,
        patron_enCamino_reprog_enCamino: inc_patron
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

router.get('/home', kpisDiaHandler);
router.get('/dia',  kpisDiaHandler);
module.exports = router;
