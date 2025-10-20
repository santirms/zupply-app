// routes/meli.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const cors    = require('cors');

const Token   = require('../models/Token');
const Cliente = require('../models/Cliente');
const Envio   = require('../models/Envio');

const { getValidToken } = require('../utils/meliUtils');     // usado en /ping
const { ingestShipment } = require('../services/meliIngest'); // ÚNICA fuente de verdad
const { assertCronAuth } = require('../middlewares/cronAuth');
const { backfillCliente } = require('../services/meliBackfill');
const { ensureMeliHistory } = require('../services/meliHistory');
const logger = require('../utils/logger');

const CLIENT_ID     = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.MERCADOLIBRE_REDIRECT_URI;


/* -------------------------------------------
 * OAuth callback MeLi
 * ----------------------------------------- */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      // si querés: redirigir a linked con error
      const u = new URL('https://linked.zupply.tech/');
      u.searchParams.set('ok', '0');
      u.searchParams.set('msg', 'Faltan parámetros en callback');
      return res.redirect(302, u.toString());
    }

    // 1) Intercambio de código por tokens
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  REDIRECT_URI, // debe coincidir EXACTO con el configurado en ML
    });

    const tokenRes = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, user_id, expires_in } = tokenRes.data;

    // 2) Persistir/actualizar tokens
    await Token.findOneAndUpdate(
      { user_id },
      {
        access_token,
        refresh_token,
        expires_in,
        fecha_creacion: new Date(),
        updatedAt: new Date(),
      },
      { upsert: true }
    );

    // 3) Vincular cliente (state = "clienteId|senderId")
    const [clienteId, senderId] = String(state).split('|');
    await Cliente.findByIdAndUpdate(clienteId, {
      user_id,
      $addToSet: { sender_id: senderId },
    });

    // Datos opcionales para mostrar en la landing
    const clienteDoc = await Cliente.findById(clienteId).select('nombre').lean();
    const nombre = clienteDoc?.nombre || '';

    let nickname = '';
    try {
      const me = await axios.get('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      nickname = me.data?.nickname || '';
    } catch (_) { /* ignoro si falla */ }

    // 4) Redirección a tu landing en el subdominio
    const url = new URL('https://linked.zupply.tech/');
    if (nombre)   url.searchParams.set('cliente', nombre);
    if (senderId) url.searchParams.set('sender',  senderId);
    if (nickname) url.searchParams.set('nickname', nickname);

    return res.redirect(303, url.toString());

  } catch (err) {
    logger.error('Error en OAuth callback', {
      error: err?.response?.data || err.message,
      stack: err?.stack,
      request_id: req.requestId
    });

    const u = new URL('https://linked.zupply.tech/');
    u.searchParams.set('ok', '0');
    u.searchParams.set('msg', err?.response?.data?.message || 'Error durante el callback OAuth');
    return res.redirect(302, u.toString());
  }
});

   
  
/* -------------------------------------------
 * Probar token (users/me)
 * GET /api/auth/meli/ping/:clienteId
 * ----------------------------------------- */
router.get('/ping/:clienteId', async (req, res) => {
  try {
    const cliente = await Cliente.findById(req.params.clienteId);
    if (!cliente) return res.status(404).json({ ok:false, error:'Cliente no encontrado' });
    if (!cliente.user_id) return res.status(400).json({ ok:false, error:'Cliente no vinculado (sin user_id)' });

    const access_token = await getValidToken(cliente.user_id);
    const r = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    return res.json({ ok: true, user_id: r.data.id, nickname: r.data.nickname });
  } catch (err) {
    logger.error('Ping token error', {
      error: err.response?.data || err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    return res.status(500).json({ ok:false, error: err.response?.data?.message || err.message });
  }
});

/* -------------------------------------------
 * Webhook (topic: shipments)
 * POST /api/auth/meli/webhook
 * ----------------------------------------- */
// routes/meli.js  (webhook)
router.options('/webhook', cors());
router.post('/webhook', cors(), async (req, res) => {
  const startTime = Date.now();
  try {
    logger.info('[ML Webhook DEBUG] Headers', {
      headers: req.headers,
      hasAuth: !!req.headers?.authorization,
      path: req.path,
      baseUrl: req.baseUrl
    });

    const { user_id, resource, topic } = req.body || {};
    res.status(200).json({ ok: true });           // respondé rápido

    if (topic !== 'shipments' || !resource || !user_id) return;

    const cliente = await Cliente.findOne({ user_id }).populate('lista_precios');
    if (!cliente || !cliente.auto_ingesta) return;

    const shipmentId = String(resource.split('/').pop());
    logger.ml('Webhook received', shipmentId, {
      topic,
      resource,
      user_id,
      request_id: req.requestId
    });

    await ingestShipment({ shipmentId, cliente });

    // ✅ hidratar historial con horas reales de MeLi
    const token = await getValidToken(cliente.user_id);
    const envio = await Envio.findOne({ meli_id: shipmentId }).lean();
    if (envio) await ensureMeliHistory(envio._id, { token, force: true });

    logger.ml('Webhook processed', shipmentId, {
      result: 'success',
      duration_ms: Date.now() - startTime,
      request_id: req.requestId
    });
  } catch (err) {
    logger.error('Webhook ML error', {
      error: err?.response?.data || err.message,
      stack: err?.stack,
      request_id: req.requestId
    });
  }
});


/* -------------------------------------------
 * Forzar sync de un envío por meli_id
 * POST /api/auth/meli/force-sync/:meli_id
 * ----------------------------------------- */
router.post('/force-sync/:meli_id', async (req, res) => {
  try {
    const meli_id = String(req.params.meli_id);
    const envio = await Envio.findOne({ meli_id }).populate('cliente_id');
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const cliente = await Cliente.findById(envio.cliente_id).populate('lista_precios');
    if (!cliente?.user_id) return res.status(400).json({ error: 'Cliente sin user_id MeLi' });

    const updated = await ingestShipment({ shipmentId: meli_id, cliente });

    const token = await getValidToken(cliente.user_id);     // <<< DEFINIDO
    await ensureMeliHistory(envio._id, { token, force: true });

    const latest = await Envio.findById(envio._id).lean();
    res.json({ ok: true, envio: latest || updated });
  } catch (err) {
    logger.error('force-sync error', {
      error: err.response?.data || err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ error: 'Error al sincronizar' });
  }
});

/* -------------------------------------------
 * Sync masivo (para cron/worker)
 * POST /api/auth/meli/sync-pending
 * ----------------------------------------- */
router.post('/sync-pending', assertCronAuth, async (req, res) => {
  try {
    const pendientes = await Envio.find({
      meli_id: { $ne: null },
      $or: [
        { estado: { $nin: ['entregado','cancelado'] } },
        { 'estado_meli.status': { $nin: ['delivered','cancelled'] } }
      ]
    }).limit(100);

    let ok = 0, fail = 0, hist = 0;
    for (const e of pendientes) {
      try {
        const cliente = await Cliente.findById(e.cliente_id).populate('lista_precios');
        if (!cliente?.user_id) { fail++; continue; }

        await ingestShipment({ shipmentId: e.meli_id, cliente });

        const token = await getValidToken(cliente.user_id);  // <<< DEFINIDO
        await ensureMeliHistory(e._id, { token, force: true });
        hist++;
        ok++;
      } catch (err) {
        fail++;
        logger.error('sync item error', {
          envio_id: e._id,
          error: err?.response?.data || err.message,
          stack: err?.stack
        });
      }
      await new Promise(r => setTimeout(r, 150)); // rate limit suave
    }
    res.json({ ok, fail, hist, total: pendientes.length });
  } catch (err) {
    logger.error('sync-pending error', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ error: 'Error en sync-pending' });
  }
});


 router.post('/hydrate-today', assertCronAuth, async (req, res) => {
  try {
    const hours = Number(req.query.hours || 24);
    const since = new Date();
    since.setHours(since.getHours() - hours, 0, 0, 0);

    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const endOfToday   = new Date(); endOfToday.setHours(23,59,59,999);

    const envios = await Envio.find({
      meli_id: { $ne: null },
      fecha:   { $gte: since }
    }).limit(1000);

    for (const e of envios) {
      try {
        const cliente = await Cliente.findById(e.cliente_id);
        if (!cliente?.user_id) continue;
        const token = await getValidToken(cliente.user_id);
        await ensureMeliHistory(e._id, { token, force: true });
        await new Promise(r => setTimeout(r, 120)); // rate-limit suave
      } catch (err) {
        logger.warn('hydrate-today item fail', {
          envio_id: e._id,
          error: err.message
        });
      }
    }

    const refreshed = await Envio.find({ _id: { $in: envios.map(v => v._id) } })
      .select('_id meli_id estado estado_meli historial fecha')
      .lean();

    const noActualizadosHoy = [];
    const resumen = [];

    for (const e of refreshed) {
      const eventosHoy = (e.historial || []).filter(h =>
        h.source === 'meli-history' &&
        h.at >= startOfToday && h.at <= endOfToday
      );

      const lastMeli = (e.historial || [])
        .filter(h => h.source === 'meli-history')
        .sort((a,b) => new Date(b.at) - new Date(a.at))[0];

      if (eventosHoy.length === 0) {
        noActualizadosHoy.push({
          _id: e._id,
          meli_id: e.meli_id,
          fecha: e.fecha,
          estado_db: e.estado,
          estado_meli_db: e.estado_meli?.status || null,
          last_meli_event: lastMeli ? {
            at: lastMeli.at,
            status: lastMeli.estado_meli?.status || lastMeli.estado,
            substatus: lastMeli.estado_meli?.substatus || null
          } : null
        });
      }

      if (lastMeli) {
        resumen.push({
          _id: e._id,
          meli_id: e.meli_id,
          last_event_at: lastMeli.at,
          last_status: lastMeli.estado_meli?.status || lastMeli.estado,
          last_substatus: lastMeli.estado_meli?.substatus || null
        });
      }
    }

    res.json({
      ok: true,
      scanned: envios.length,
      updated: refreshed.length,
      noActualizadosHoy_count: noActualizadosHoy.length,
      noActualizadosHoy,
      sampleUltimos: resumen.slice(0, 20)
    });
  } catch (err) {
    logger.error('hydrate-today error', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ ok:false, error: err.message });
  }
});

/* -------------------------------------------
 * (OPCIONAL) Backfill de id_venta para envíos antiguos
 * POST /api/auth/meli/backfill-order-id
 * ----------------------------------------- */
router.post('/backfill-order-id', async (req, res) => {
  try {
    const toFix = await Envio.find({
      meli_id: { $ne: null },
      $or: [{ id_venta: { $exists: false } }, { id_venta: { $in: [null, ''] } }]
    }).limit(200);

    let ok = 0, fail = 0;
    for (const e of toFix) {
      try {
        const cliente = await Cliente.findById(e.cliente_id);
        if (!cliente?.user_id) { fail++; continue; }
        await ingestShipment({ shipmentId: e.meli_id, cliente }); // esto setea id_venta=order_id
        ok++;
      } catch (err) {
        fail++;
        logger.error('backfill item error', {
          envio_id: e._id,
          error: err?.response?.data || err.message,
          stack: err?.stack
        });
      }
      await new Promise(r => setTimeout(r, 120));
    }
    res.json({ ok, fail, total: toFix.length });
  } catch (err) {
    logger.error('backfill-order-id error', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ error: 'Error en backfill-order-id' });
  }
});

// Backfill de un cliente puntual (últimos N días)
router.post('/backfill/:clienteId', async (req, res) => {
  try {
    const days = Number(req.query.days || 7);
    const cliente = await Cliente.findById(req.params.clienteId).populate('lista_precios');
    if (!cliente) return res.status(404).json({ ok:false, error:'Cliente no encontrado' });
    if (!cliente.user_id) return res.status(400).json({ ok:false, error:'Cliente sin user_id MeLi' });

    const r = await backfillCliente({ cliente, days });
    return res.json({ ok:true, ...r });
  } catch (err) {
    logger.error('backfill cliente error', {
      error: err.response?.data || err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ ok:false, error:'Error en backfill' });
  }
});

// Backfill para todos los clientes con auto_ingesta
router.post('/backfill-all', async (req, res) => {
  try {
    const days = Number(req.query.days || 2);
    const clientes = await Cliente.find({
      auto_ingesta: true,
      user_id: { $exists: true, $ne: null }
    }).populate('lista_precios');

    let stats = [];
    for (const cliente of clientes) {
      const r = await backfillCliente({ cliente, days });
      stats.push({ cliente: cliente._id, nombre: cliente.nombre, ...r });
      await new Promise(r => setTimeout(r, 300));
    }
    res.json({ ok:true, totalClientes: clientes.length, stats });
  } catch (err) {
    logger.error('backfill-all error', {
      error: err.response?.data || err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    res.status(500).json({ ok:false, error:'Error en backfill-all' });
  }
});

router.get('/debug/pending-linked', async (req, res) => {
  try {
    const clientesVinc = await Cliente.find({ user_id: { $exists: true, $ne: null } }, { _id:1 });
    const idsVinc = clientesVinc.map(c => c._id);

    const allWithMeli = await Envio.countDocuments({ meli_id: { $ne: null } });
    const linkedAll   = await Envio.countDocuments({ meli_id: { $ne: null }, cliente_id: { $in: idsVinc } });
    const linkedPending = await Envio.find({
      meli_id: { $ne: null },
      cliente_id: { $in: idsVinc },
      $or: [
        { estado: { $nin: ['entregado','cancelado'] } },
        { 'estado_meli.status': { $nin: ['delivered','cancelled'] } },
        { estado: { $exists: false } }
      ]
    }).select('_id meli_id estado estado_meli.status cliente_id fecha').limit(20).lean();

    res.json({
      ok: true,
      counts: { allWithMeli, linkedAll, linkedPending: linkedPending.length, clientesVinc: idsVinc.length },
      sample: linkedPending
    });
  } catch (e) {
    logger.error('debug/pending-linked', {
      error: e.message,
      stack: e.stack
    });
    res.status(500).json({ ok:false, error:'debug failed' });
  }
});


module.exports = router;
