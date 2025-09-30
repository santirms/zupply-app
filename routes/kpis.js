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
    const win36Start = new Date(Date.now() - 36*60*60*1000);
    const ult36h = await Envio.find(
      { fecha: { $gte: win36Start } },
      'estado estado_meli historial notas chofer'
    ).lean();

    const incidencias = ult36h.filter(e=>{
      const st  = (e.estado||'').toLowerCase();
      const sub = (e.estado_meli?.substatus||'').toLowerCase();
      const hasNotes  = Array.isArray(e.notas) && e.notas.length>0;
      const reprogram = st==='reprogramado' || /resched/.test(sub);
      const cancel    = st==='cancelado';
      const delay     = /delay/.test(sub);
      const sinChofer = !e.chofer;

      let patron = false;
      if (Array.isArray(e.historial) && e.historial.length>=3){
        const joined = e.historial.map(h => (h.estado||'').toLowerCase()).join('|');
        patron = /en_camino\|reprogramado\|en_camino/.test(joined);
      }
      return hasNotes || reprogram || cancel || delay || sinChofer || patron;
    }).length;

    res.json({ pendientes, en_ruta, entregados, incidencias });
  } catch(e){
    console.error('KPIs /home error', e);
    res.status(500).json({ error:'server_error' });
  }
}

router.get('/home', kpisDiaHandler);
router.get('/dia',  kpisDiaHandler);
module.exports = router;
