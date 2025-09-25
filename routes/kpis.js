const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

function dateFromPartsLocal(dayISO, horaStr = '13:00') {
  const [H='13', m='00'] = String(horaStr).split(':');
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}
function buildCutWindowForToday(hora_corte_str) {
  const hoy = new Date();
  const d   = hoy.toISOString().slice(0,10);
  const ay  = new Date(hoy.getTime() - 24*60*60*1000);
  const end   = dateFromPartsLocal(d,   hora_corte_str||'13:00');
  const start = dateFromPartsLocal(ay.toISOString().slice(0,10), hora_corte_str||'13:00');
  return { start, end };
}
const isEnRuta   = (e) => ['asignado','en_camino'].includes((e.estado||'').toLowerCase());
const isEntregado= (e) => (e.estado||'').toLowerCase() === 'entregado';

async function kpisDiaHandler(req, res) {
  try {
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
    const autoIds = [], manualIds = [], ventanas = new Map();
    for (const c of clientes) {
      const id = String(c._id);
      if (c.auto_ingesta) { autoIds.push(id); ventanas.set(id, buildCutWindowForToday(c.hora_corte||'13:00')); }
      else manualIds.push(id);
    }

    const hoyISO = new Date().toISOString().slice(0,10);
    const manualStart = dateFromPartsLocal(hoyISO, '00:00');
    const manualEnd   = dateFromPartsLocal(hoyISO, '23:59');

    const [candAuto, candManual] = await Promise.all([
      autoIds.length   ? Envio.find({ cliente_id: { $in: autoIds } }).lean() : [],
      manualIds.length ? Envio.find({ cliente_id: { $in: manualIds }, fecha: { $gte: manualStart, $lte: manualEnd } }).lean() : []
    ]);

    const enHoyAuto = candAuto.filter(e => {
      const v = ventanas.get(String(e.cliente_id)); if (!v) return false;
      const f = new Date(e.fecha); return f >= v.start && f < v.end;
    });
    const enHoy = enHoyAuto.concat(candManual);

    const pendientes = enHoy.filter(e => !isEntregado(e) && (e.estado||'').toLowerCase() !== 'cancelado').length;
    const en_ruta    = enHoy.filter(isEnRuta).length;
    const entregados = enHoy.filter(isEntregado).length;

    const win36Start = new Date(Date.now() - 36*60*60*1000);
    const ult36h = await Envio.find({ fecha: { $gte: win36Start } }, 'estado historial notas chofer').lean();
    const incidencias = ult36h.filter(e => {
      const hasNotes = Array.isArray(e.notas) && e.notas.length > 0;
      const reprogram = (e.estado||'').toLowerCase() === 'reprogramado';
      const cancel    = (e.estado||'').toLowerCase() === 'cancelado';
      const sinChofer = !e.chofer;
      let patron = false;
      if (Array.isArray(e.historial) && e.historial.length >= 3) {
        const joined = e.historial.map(h => (h.estado||'').toLowerCase()).join('|');
        patron = /en_camino\|reprogramado\|en_camino/.test(joined);
      }
      return hasNotes || reprogram || cancel || sinChofer || patron;
    }).length;

    res.json({ pendientes, en_ruta, entregados, incidencias });
  } catch (e) {
    console.error('KPIs /home error', e);
    res.status(500).json({ error: 'server_error' });
  }
}

async function kpisDiaDebug(req,res){
  try {
    res.json({ ok:true }); // si querés, armamos el detalle luego
  } catch(e){ res.status(500).json({error:'server_error'}); }
}

router.get('/ping', (req,res)=> res.json({ ok:true }));
router.get('/home', kpisDiaHandler);
router.get('/home/debug', kpisDiaDebug);
router.get('/dia', kpisDiaHandler);
router.get('/dia/debug', kpisDiaDebug);

module.exports = router;
