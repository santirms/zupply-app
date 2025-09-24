// routes/kpis.js
const express = require('express');
const router  = express.Router();
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { requireAuth } = require('../middlewares/auth');

// util: ventana por “hora de corte” (timezone AR -03:00)
function dayWindowByCutoff(dateStr, hour=13) {
  const base = dateStr ? new Date(`${dateStr}T13:00:00-03:00`) : null;
  const now  = base || new Date();
  // normalizo a -03:00 manteniendo fecha
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const mk = (h,dd = d) => new Date(`${y}-${String(m+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00-03:00`);

  // ventana “de ayer a hoy” por hora de corte
  const start = new Date(mk(hour, d-1));  // ayer hh:00:00
  const end   = new Date(mk(hour, d));    // hoy hh:00:00
  return { start, end };
}

router.get('/home', requireAuth, async (req, res) => {
  try {
    // fecha objetivo opcional ?date=YYYY-MM-DD (default: hoy)
    const dateStr = (req.query.date || '').trim() || null;

    // 36h atrás (incidencias / en-ruta)
    const since36h = new Date(Date.now() - 36*60*60*1000);

    // clientes y cortes
    const clientes = await Cliente.find({}, 'auto_ingesta hora_corte').lean();
    const autoIds  = clientes.filter(c => !!c.auto_ingesta).map(c => String(c._id));
    const nonIds   = clientes.filter(c => !c.auto_ingesta).map(c => String(c._id));
    const cutoffById = new Map(
      clientes
        .filter(c => !!c.auto_ingesta)
        .map(c => [ String(c._id), (Number(c.hora_corte) >=0 ? Number(c.hora_corte) : 13) ])
    );

    // ventanas “pendientes” por cliente auto_ingesta
    const windows = {};
    for (const id of autoIds) {
      const hour = cutoffById.get(id) ?? 13;
      windows[id] = dayWindowByCutoff(dateStr, hour);
    }
    // ventana “día calendario” para NO auto_ingesta
    const dayStart = dateStr
      ? new Date(`${dateStr}T00:00:00-03:00`)
      : new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate()+1);

    // ====== PENDIENTES ======
    // auto_ingesta: sumo por cliente su ventana
    const pendingAutoPromises = autoIds.map(id =>
      Envio.countDocuments({
        cliente_id: id,
        fecha: { $gte: windows[id].start, $lt: windows[id].end }
      })
    );
    // no auto_ingesta: día calendario
    const pendingNonPromise =
      nonIds.length
        ? Envio.countDocuments({
            cliente_id: { $in: nonIds },
            fecha: { $gte: dayStart, $lt: dayEnd }
          })
        : Promise.resolve(0);

    // ====== EN RUTA (36h) ======
    // estado propio o Meli que indica “en camino”
    const enRutaPromise = Envio.countDocuments({
      $or: [
        { estado: 'en_camino' },
        { 'estado_meli.status': 'shipped' },
        { 'estado_meli.substatus': /out_for_delivery|arriving|soon/i }
      ],
      $or: [
        { updatedAt: { $gte: since36h } },
        { fecha:     { $gte: since36h } }
      ]
    });

    // ====== ENTREGADOS (día por historial) ======
    const entregadosPromise = Envio.countDocuments({
      historial: {
        $elemMatch: {
          estado: 'entregado',
          at: { $gte: dayWindowByCutoff(dateStr, 13).start, $lt: dayWindowByCutoff(dateStr, 13).end }
        }
      }
    });

    // ====== INCIDENCIAS (36h) ======
    // - con notas
    // - reprogramado (propio o meli)
    // - cancelado
    // - patrón en_camino ➜ reprogramado ➜ en_camino (aprox: contiene ambos y estado actual en_camino)
    // - sin chofer
    const incidenciasPromise = Envio.countDocuments({
      $and: [
        { $or: [
          { 'notas.0': { $exists: true } },
          { estado: 'reprogramado' },
          { 'estado_meli.substatus': /resched/i },
          { estado: 'cancelado' },
          {
            $and: [
              { estado: 'en_camino' },
              { 'historial.estado': 'reprogramado' },
              { 'historial.estado': 'en_camino' }
            ]
          },
          { chofer: { $exists: false } },
          { chofer: null }
        ]},
        { $or: [
          { updatedAt: { $gte: since36h } },
          { fecha:     { $gte: since36h } },
          { 'historial.at': { $gte: since36h } }
        ]}
      ]
    });

    const [pendNon, enRuta, entregados, incidencias, ...pendAutos] = await Promise.all([
      pendingNonPromise,
      enRutaPromise,
      entregadosPromise,
      incidenciasPromise,
      ...pendingAutoPromises
    ]);
    const pendientes = pendAutos.reduce((a,b)=>a+b, 0) + pendNon;

    res.json({ ok:true, pendientes, en_ruta: enRuta, entregados, incidencias });
  } catch (e) {
    console.error('KPIs /home error', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
