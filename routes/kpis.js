// routes/kpis.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

// ===== Helpers =====
function dateFromPartsLocal(dayISO, horaStr = '13:00') {
  const [H='13', m='00'] = String(horaStr).split(':');
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}
function buildCutWindowForToday(hora_corte_str) {
  const hoy  = new Date();
  const day  = hoy.toISOString().slice(0,10);
  const prev = new Date(hoy.getTime() - 24*60*60*1000).toISOString().slice(0,10);
  const end   = dateFromPartsLocal(day,  hora_corte_str||'13:00');
  const start = dateFromPartsLocal(prev, hora_corte_str||'13:00');
  return { start, end };
}
const isEnRuta      = (e) => ['asignado','en_camino'].includes((e.estado||'').toLowerCase());
const isEntregado   = (e) => (e.estado||'').toLowerCase() === 'entregado';

// === core: calcula KPIs del día ===
async function computeKpisDia() {
  // clientes y ventanas por hora de corte (string "HH:mm")
  const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
  const autoIds = [], manualIds = [], ventanas = new Map();
  for (const c of clientes) {
    const id = String(c._id);
    if (c.auto_ingesta) { autoIds.push(id); ventanas.set(id, buildCutWindowForToday(c.hora_corte || '13:00')); }
    else { manualIds.push(id); }
  }

  // ventana calendario para manuales
  const hoyIso = new Date().toISOString().slice(0,10);
  const manualStart = dateFromPartsLocal(hoyIso, '00:00');
  const manualEnd   = dateFromPartsLocal(hoyIso, '23:59');

  // candidatos
  const [candAuto, candManual] = await Promise.all([
    autoIds.length   ? Envio.find({ cliente_id: { $in: autoIds } }, 'cliente_id fecha estado historial notas chofer').lean() : [],
    manualIds.length ? Envio.find({
      cliente_id: { $in: manualIds },
      fecha: { $gte: manualStart, $lte: manualEnd }
    }, 'cliente_id fecha estado historial notas chofer').lean() : []
  ]);

  // filtrar autos por ventana de su cliente
  const enHoyAuto = candAuto.filter(e => {
    const v = ventanas.get(String(e.cliente_id));
    if (!v) return false;
    const f = new Date(e.fecha);
    return f >= v.start && f < v.end;
  });

  const enHoy = enHoyAuto.concat(candManual);

  // KPIs base
  const pendientes = enHoy.filter(e => !isEntregado(e) && (e.estado||'') !== 'cancelado').length;
  const en_ruta    = enHoy.filter(e => isEnRuta(e)).length;
  const entregados = enHoy.filter(e => isEntregado(e)).length;

  // incidencias 36h
  const win36Start = new Date(Date.now() - 36*60*60*1000);
  const ult36h = await Envio.find(
    { fecha: { $gte: win36Start } },
    'estado historial notas chofer'
  ).lean();

  const incidencias = ult36h.filter(e => {
    const st = (e.estado||'').toLowerCase();
    const hasNotes = Array.isArray(e.notas) && e.notas.length > 0;
    const reprogram = st === 'reprogramado';
    const cancel    = st === 'cancelado';
    const sinChofer = !e.chofer;

    let patron = false;
    if (Array.isArray(e.historial) && e.historial.length >= 3) {
      const joined = e.historial.map(h => (h.estado||'').toLowerCase()).join('|');
      patron = /en_camino\|reprogramado\|en_camino/.test(joined);
    }

    return hasNotes || reprogram || cancel || patron || sinChofer;
  }).length;

  return { pendientes, en_ruta, entregados, incidencias };
}

// ===== Handlers =====
async function kpisDiaHandler(req, res) {
  try {
    const k = await computeKpisDia();
    res.json(k);
  } catch (e) {
    console.error('KPIs /dia error', e);
    res.status(500).json({ error: 'server_error' });
  }
}

async function kpisDiaDebug(req, res) {
  try {
    // devolvemos también un desglose útil
    const k = await computeKpisDia();
    res.json(k);
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
}

// ===== Rutas (sin duplicar) =====
router.get('/dia', kpisDiaHandler);
router.get('/dia/debug', kpisDiaDebug);
// alias para el front
router.get('/home', kpisDiaHandler);
router.get('/home/debug', kpisDiaDebug);

module.exports = router;
