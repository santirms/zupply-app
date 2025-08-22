// routes/meli.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Token   = require('../models/Token');
const Cliente = require('../models/Cliente');
const Envio   = require('../models/Envio');

const { getValidToken } = require('../utils/meliUtils');     // usado en /ping
const { ingestShipment } = require('../services/meliIngest'); // ÚNICA fuente de verdad

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
      return res.status(400).send('Faltan parámetros en callback');
    }

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri:  REDIRECT_URI
    });

    const tokenRes = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, user_id, expires_in } = tokenRes.data;

    await Token.findOneAndUpdate(
      { user_id },
      {
        access_token,
        refresh_token,
        expires_in,
        fecha_creacion: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );

    // Vincular cliente (state = "clienteId|senderId")
    const [clienteId, senderId] = String(state).split('|');
    await Cliente.findByIdAndUpdate(clienteId, {
      user_id,
      $addToSet: { sender_id: senderId }
    });

    return res.send('✅ Autenticación exitosa y cliente vinculado.');
  } catch (err) {
    console.error('Error en OAuth callback:', err.response?.data || err.message);
    return res.status(500).send('❌ Error durante el callback OAuth');
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
    console.error('Ping token error:', err.response?.data || err.message);
    return res.status(500).json({ ok:false, error: err.response?.data?.message || err.message });
  }
});

/* -------------------------------------------
 * Webhook (topic: shipments)
 * POST /api/auth/meli/webhook
 * ----------------------------------------- */
router.post('/webhook', async (req, res) => {
  try {
    const { user_id, resource, topic } = req.body || {};

    // Responder rápido para evitar reintentos de MeLi
    res.status(200).json({ ok: true });

    if (topic !== 'shipments' || !resource || !user_id) return;

    // Cliente con lista de precios
    const cliente = await Cliente.findOne({ user_id }).populate('lista_precios');
    if (!cliente || !cliente.auto_ingesta) return;

    const shipmentId = String(resource.split('/').pop());

    // Ingesta idempotente (crea/actualiza, mapea estado, precio, id_venta, etc.)
    await ingestShipment({ shipmentId, cliente });

  } catch (err) {
    console.error('Webhook ML error:', err?.response?.data || err.message);
    // ya respondimos 200
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

    // Traer cliente con lista de precios
    const cliente = await Cliente.findById(envio.cliente_id).populate('lista_precios');
    if (!cliente?.user_id) return res.status(400).json({ error: 'Cliente sin user_id MeLi' });

    // Única fuente de verdad: esto también persiste id_venta (order_id)
    const updated = await ingestShipment({ shipmentId: meli_id, cliente });
    res.json({ ok: true, envio: updated });
  } catch (err) {
    console.error('force-sync error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al sincronizar' });
  }
});

/* -------------------------------------------
 * Sync masivo (para cron/worker)
 * POST /api/auth/meli/sync-pending
 * ----------------------------------------- */
router.post('/sync-pending', async (req, res) => {
  try {
    // Traer envíos no terminales (internos) o sin estado terminal de MeLi
    const pendientes = await Envio.find({
      meli_id: { $ne: null },
      $or: [
        { estado: { $nin: ['entregado','cancelado'] } },
        { 'estado_meli.status': { $nin: ['delivered','cancelled'] } }
      ]
    }).limit(100);

    let ok = 0, fail = 0;
    for (const e of pendientes) {
      try {
        const cliente = await Cliente.findById(e.cliente_id).populate('lista_precios');
        if (!cliente?.user_id) { fail++; continue; }

        await ingestShipment({ shipmentId: e.meli_id, cliente });
        ok++;
      } catch (err) {
        fail++;
        console.error('sync item error:', e._id, err?.response?.data || err.message);
      }
      // rate limit suave
      await new Promise(r => setTimeout(r, 150));
    }
    res.json({ ok, fail, total: pendientes.length });
  } catch (err) {
    console.error('sync-pending error:', err);
    res.status(500).json({ error: 'Error en sync-pending' });
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
        console.error('backfill item error:', e._id, err?.response?.data || err.message);
      }
      await new Promise(r => setTimeout(r, 120));
    }
    res.json({ ok, fail, total: toFix.length });
  } catch (err) {
    console.error('backfill-order-id error:', err);
    res.status(500).json({ error: 'Error en backfill-order-id' });
  }
});

module.exports = router;
