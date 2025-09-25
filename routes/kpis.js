// routes/kpis.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

// helpers de tiempo (AR -03:00)
function dateFromPartsLocal(dayISO, hm = '13:00') {
  const [H='13', m='00'] = String(hm).split(':');
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}
function buildCutWindowForToday(hora_corte_str) {
  const now = new Date();
  const hoyISO  = now.toISOString().slice(0,10);
  const ayerISO = new Date(now.getTime() - 24*60*60*1000).toISOString().slice(0,10);
  return {
    start: dateFromPartsLocal(ayerISO, hora_corte_str || '13:00'),
    end:   dateFromPartsLocal(hoyISO,  hora_corte_str || '13:00'),
  };
}

// normalizaciones
const st = s => (s || '').toString().toLowerCase();
const isEnRuta     = e => ['asignado','en_camino'].includes(st(e.estado));
const isEntregado  = e => st(e.estado) === 'entregado';
const isCancelado  = e => st(e.estado) === 'cancelado';
const isIncidenciaEstado = e =>
  ['reprogramado','demorado','no_entregado','comprador_ausente'].includes(st(e.estado));

// --- KPI principal ---
router.get('/home', async (req, res) => {
  try {
    // 1) clientes y ventanas por hora de corte
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
    const autoIds = [], manualIds = [], ventanas = new Map();
    for (const c of clientes) {
      const id = String(c._id);
      if (c.auto_ingesta) {
        autoIds.push(id);
        ventanas.set(id, buildCutWindowForToday(c.hora_corte || '13:00'));
      } else {
        manualIds.push(id);
      }
    }

    // inicio/fin de HOY (para manuales)
    const hoyISO = new Date().toISOString().slice(0,10);
    const manualStart = dateFromPartsLocal(hoyISO, '00:00');
    const manualEnd   = dateFromPartsLocal(hoyISO, '23:59');

    // 2) candidatos de hoy
    const [candAuto, candManual] = await Promise.all([
      autoIds.length
        ? Envio.find({ cliente_id: { $in: autoIds } }).lean()
        : [],
      manualIds.length
        ? Envio.find({
            cliente_id: { $in: manualIds },
            fecha: { $gte: manualStart, $lte: manualEnd }
          }).lean()
        : [],
    ]);

    // filtrar autos por su ventana (ayer 13:00 → hoy 12:59)
    const enHoyAuto = candAuto.filter(e => {
      const v = ventanas.get(String(e.cliente_id));
      if (!v) return false;
      const f = new Date(e.fecha);
      return f >= v.start && f < v.end;
    });

    const enHoy = enHoyAuto.concat(candManual);

    // 3) carryover (incidencias activas previas a HOY)
    // tomo el inicio mínimo de todas las ventanas para cortar “hoy”
    const minStartHoy = [...ventanas.values()].reduce(
      (acc, v) => (!acc || v.start < acc ? v.start : acc),
      manualStart
    );

    const win36Start = new Date(minStartHoy.getTime() - 36*60*60*1000);
    // candidatos últimos 36h hasta el inicio de hoy
    const candCarry = await Envio.find(
      { fecha: { $gte: win36Start, $lt: minStartHoy } },
      'estado historial notas chofer fecha'
    ).lean();

    // incidencias activas: con nota o estado de incidencia, y no entregadas/canceladas
    const carryActive = candCarry.filter(e => {
      const hasNote = Array.isArray(e.notas) && e.notas.length > 0;
      const byState = isIncidenciaEstado(e);
      // patrón en_camino -> reprogramado -> en_camino
      let patron = false;
      if (Array.isArray(e.historial) && e.historial.length >= 3) {
        const joined = e.historial.map(h => st(h.estado)).join('|');
        patron = /en_camino\|reprogramado\|en_camino/.test(joined);
      }
      return (hasNote || byState || patron) && !isEntregado(e) && !isCancelado(e);
    });

    // 4) set base para en_ruta / entregados / pendientes
    const base = enHoy.concat(carryActive);

    const pendientes = base.filter(e => !isEntregado(e) && !isCancelado(e)).length;
    const en_ruta    = base.filter(isEnRuta).length;
    const entregados = base.filter(isEntregado).length;
    const incidencias = carryActive.length;  // solo las activas arrastradas

    res.json({ pendientes, en_ruta, entregados, incidencias });
  } catch (e) {
    console.error('KPIs /home error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// debug opcional
router.get('/home/debug', async (req,res)=>{
  try {
    res.json({ ok:true, hint:'Cuenta sobre (pendientes de hoy + incidencias activas previas 36h). Incidencias = solo carryActive.' });
  } catch(e){ res.status(500).json({error:'server_error'}); }
});

module.exports = router;
