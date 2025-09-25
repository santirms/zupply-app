// routes/kpis.js
const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');

// helper: arma Date a partir de YYYY-MM-DD + "HH:mm" (hora_corte)
function dateFromPartsLocal(dayISO, horaStr = '13:00') {
  const [H='13', m='00'] = String(horaStr).split(':');
  // AR -03:00 (ajustá si usás otra tz en server)
  return new Date(`${dayISO}T${H.padStart(2,'0')}:${m.padStart(2,'0')}:00-03:00`);
}

// construye start/end para cada cliente según su hora_corte (string "HH:mm")
// start = ayer a la hora de corte; end = hoy a la hora de corte
function buildCutWindowForToday(hora_corte_str) {
  const hoy = new Date();
  const d   = hoy.toISOString().slice(0,10);                          // YYYY-MM-DD hoy
  const ay  = new Date(hoy.getTime() - 24*60*60*1000);                // hoy-1d
  const day = d;
  const prev= ay.toISOString().slice(0,10);
  const end   = dateFromPartsLocal(day, hora_corte_str||'13:00');
  const start = dateFromPartsLocal(prev, hora_corte_str||'13:00');
  return { start, end };
}

// Estados “base” (tu front ya normaliza así)
const isEnRuta = (e) => ['asignado','en_camino'].includes(e.estado);
const isEntregado = (e) => e.estado === 'entregado';
const isIncidenciaByEstado = (e) => ['reprogramado','cancelado','no_entregado','comprador_ausente','demorado']
  .includes(e.estado);

/**
 * KPI “Pendientes de hoy”
 *  - Clientes con auto_ingesta: ventas en [corte-ayer, corte-hoy)
 *  - Clientes SIN auto_ingesta: envíos con fecha == hoy (calendario) [00:00, 23:59:59]
 *  -> Contamos como pendientes los que NO estén entregados ni cancelados.
 */
router.get('/dia', async (req, res) => {
  try {
    // 1) Traigo todos los clientes con los dos atributos que necesito
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();

    // 2) Separo ids por tipo
    const autoIds = [];
    const manualIds = [];
    const ventanas = new Map(); // clienteId -> {start, end}
    for (const c of clientes) {
      const id = c._id.toString();
      if (c.auto_ingesta) {
        autoIds.push(id);
        ventanas.set(id, buildCutWindowForToday(c.hora_corte || '13:00'));
      } else {
        manualIds.push(id);
      }
    }

    // 3) Ventana “hoy” calendario para los manuales
    const hoy = new Date();
    const dIso = hoy.toISOString().slice(0,10);
    const manualStart = dateFromPartsLocal(dIso, '00:00');
    const manualEnd   = dateFromPartsLocal(dIso, '23:59');

    // 4) Busco candidatos de hoy (dos tandas) y filtro en memoria con reglas claras
    const [candAuto, candManual] = await Promise.all([
      autoIds.length ? Envio.find({ cliente_id: { $in: autoIds } }).lean() : [],
      manualIds.length ? Envio.find({
        cliente_id: { $in: manualIds },
        fecha: { $gte: manualStart, $lte: manualEnd }
      }).lean() : []
    ]);

    // aplica ventana por cliente para auto_ingesta
    const enHoyAuto = candAuto.filter(e => {
      const v = ventanas.get(String(e.cliente_id));
      if (!v) return false;
      const f = new Date(e.fecha);
      return f >= v.start && f < v.end;
    });

    const enHoy = enHoyAuto.concat(candManual);

    // === Cálculos
    const pendientes = enHoy.filter(e => !isEntregado(e) && e.estado !== 'cancelado').length;
    const enRuta     = enHoy.filter(e => isEnRuta(e)).length;
    const entregados = enHoy.filter(e => isEntregado(e)).length;

    // Incidencias 36h (definición pedida)
    const win36Start = new Date(Date.now() - 36*60*60*1000);
    const ult36h = await Envio.find({ fecha: { $gte: win36Start } }, 'estado historial notas chofer').lean();

    const incidencias = ult36h.filter(e => {
      const hasNotes = Array.isArray(e.notas) && e.notas.length > 0;
      const reprogram = e.estado === 'reprogramado';
      const cancel    = e.estado === 'cancelado';
      const sinChofer = !e.chofer; // no asignado aún

      // patrón En camino -> reprogramado -> En camino en historial
      let patrón = false;
      if (Array.isArray(e.historial) && e.historial.length >= 3) {
        const seq = e.historial.map(h => (h.estado || '').toLowerCase());
        const joined = seq.join('|');
        // ej: ...|en_camino|reprogramado|en_camino|...
        patrón = /en_camino\|reprogramado\|en_camino/.test(joined);
      }

      return hasNotes || reprogram || cancel || patrón || sinChofer;
    }).length;

    res.json({ pendientes, en_ruta: enRuta, entregados, incidencias });
  } catch (e) {
    console.error('KPIs /dia error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Endpoint de debug para ver qué está contando
 *  - Devuelve totales por estado dentro de “hoy” (con cortes)
 */
router.get('/dia/debug', async (req, res) => {
  try {
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
    const autoIds = []; const manualIds = []; const ventanas = new Map();
    for (const c of clientes) {
      const id = c._id.toString();
      if (c.auto_ingesta) { autoIds.push(id); ventanas.set(id, buildCutWindowForToday(c.hora_corte || '13:00')); }
      else manualIds.push(id);
    }
    const hoy = new Date();
    const dIso = hoy.toISOString().slice(0,10);
    const manualStart = dateFromPartsLocal(dIso, '00:00');
    const manualEnd   = dateFromPartsLocal(dIso, '23:59');

    const [candAuto, candManual] = await Promise.all([
      autoIds.length ? Envio.find({ cliente_id: { $in: autoIds } }).lean() : [],
      manualIds.length ? Envio.find({ cliente_id: { $in: manualIds }, fecha: { $gte: manualStart, $lte: manualEnd } }).lean() : []
    ]);

    const enHoy = candAuto.filter(e => {
      const v = ventanas.get(String(e.cliente_id)); if (!v) return false;
      const f = new Date(e.fecha); return f >= v.start && f < v.end;
    }).concat(candManual);

    const porEstado = enHoy.reduce((acc,e)=>{
      const k = (e.estado || '—').toLowerCase(); acc[k]=(acc[k]||0)+1; return acc;
    }, {});
    res.json({ totalHoy: enHoy.length, porEstado, sample: enHoy.slice(0,8).map(x=>({id:x._id, estado:x.estado, fecha:x.fecha, cliente:x.cliente_id})) });
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
