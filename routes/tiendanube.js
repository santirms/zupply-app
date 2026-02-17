// routes/tiendanube.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Tenant  = require('../models/Tenant');
const identifyTenant = require('../middlewares/identifyTenant');
const logger  = require('../utils/logger');

const TN_CLIENT_ID     = process.env.TIENDANUBE_CLIENT_ID;
const TN_CLIENT_SECRET = process.env.TIENDANUBE_CLIENT_SECRET;
const TN_REDIRECT_URI  = process.env.TIENDANUBE_REDIRECT_URI;
const TN_APP_ID        = process.env.TIENDANUBE_APP_ID || TN_CLIENT_ID;

const TN_AUTH_URL = 'https://www.tiendanube.com/apps/authorize/token';
const TN_API_BASE = 'https://api.tiendanube.com/v1';

/* -------------------------------------------
 * OAuth connect (iniciar vinculación TN)
 * GET /api/auth/tn/connect
 * ----------------------------------------- */
router.get('/connect', identifyTenant, (req, res) => {
  try {
    const tenantId = req.tenantId;

    const authUrl = new URL('https://www.tiendanube.com/apps/authorize/token');
    authUrl.searchParams.set('client_id', TN_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', String(tenantId));

    logger.info('TN OAuth connect initiated', {
      tenantId,
      tenant_name: req.tenant.companyName,
      request_id: req.requestId
    });

    return res.redirect(302, authUrl.toString());
  } catch (err) {
    logger.error('Error en TN OAuth connect', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    return res.status(500).json({ error: 'Error al iniciar vinculación TN' });
  }
});

/* -------------------------------------------
 * OAuth callback TN
 * GET /api/auth/tn/callback
 * ----------------------------------------- */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      logger.warn('TN callback missing params', { query: req.query });
      return res.status(400).json({ error: 'Faltan parámetros en callback' });
    }

    const tenantId = state;

    // Intercambiar code por access_token
    const tokenRes = await axios.post(TN_AUTH_URL, {
      client_id: TN_CLIENT_ID,
      client_secret: TN_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code
    });

    const { access_token, user_id: storeId } = tokenRes.data;

    if (!access_token || !storeId) {
      logger.error('TN callback: token response missing fields', {
        data: tokenRes.data,
        tenantId
      });
      return res.status(500).json({ error: 'Respuesta de TN incompleta' });
    }

    // Obtener nombre de la tienda
    let storeName = '';
    try {
      const storeRes = await axios.get(`${TN_API_BASE}/${storeId}/store`, {
        headers: { 'Authentication': `bearer ${access_token}` }
      });
      storeName = storeRes.data?.name?.es || storeRes.data?.name?.pt || storeRes.data?.name || '';
    } catch (e) {
      logger.warn('TN: could not fetch store name', { error: e.message });
    }

    // Registrar webhook order/paid
    let webhookId = null;
    try {
      const whRes = await axios.post(
        `${TN_API_BASE}/${storeId}/webhooks`,
        {
          event: 'order/paid',
          url: `${process.env.BASE_URL}/api/auth/tn/webhook`
        },
        { headers: { 'Authentication': `bearer ${access_token}` } }
      );
      webhookId = String(whRes.data?.id || '');
    } catch (e) {
      // Webhook may already exist - not critical
      logger.warn('TN: could not register webhook', {
        error: e.response?.data || e.message
      });
    }

    // Guardar en tenant
    const tenant = await Tenant.findByIdAndUpdate(
      tenantId,
      {
        'tnIntegration.storeId': String(storeId),
        'tnIntegration.storeName': storeName,
        'tnIntegration.accessToken': access_token,
        'tnIntegration.webhookId': webhookId,
        'tnIntegration.connectedAt': new Date(),
        'tnIntegration.connected': true
      },
      { new: true }
    );

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    logger.info('TN OAuth callback success', {
      tenantId,
      storeId,
      storeName,
      webhookId,
      request_id: req.requestId
    });

    // Redirigir al panel de clientes con parámetro de éxito
    return res.redirect(302, '/clientes.html?tn_connected=1');
  } catch (err) {
    logger.error('Error en TN OAuth callback', {
      error: err.response?.data || err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    return res.redirect(302, '/clientes.html?tn_connected=0&msg=' + encodeURIComponent(err.message));
  }
});

/* -------------------------------------------
 * Webhook receiver (order/paid)
 * POST /api/auth/tn/webhook
 * ----------------------------------------- */
router.post('/webhook', async (req, res) => {
  const startTime = Date.now();
  try {
    // Responder rápido
    res.status(200).json({ ok: true });

    const { store_id, event, id: orderId } = req.body || {};

    logger.info('[TN Webhook] received', {
      store_id,
      event,
      orderId,
      request_id: req.requestId
    });

    if (event !== 'order/paid' || !store_id || !orderId) return;

    // Buscar tenant por store_id
    const tenant = await Tenant.findOne({
      'tnIntegration.storeId': String(store_id),
      'tnIntegration.connected': true,
      isActive: true
    });

    if (!tenant) {
      logger.warn('TN Webhook: tenant not found', { store_id });
      return;
    }

    // Ingestar la orden
    const { ingestTnOrder } = require('../services/tnIngest');
    await ingestTnOrder({
      orderId: String(orderId),
      storeId: String(store_id),
      accessToken: tenant.tnIntegration.accessToken,
      tenantId: tenant._id
    });

    logger.info('[TN Webhook] processed', {
      store_id,
      orderId,
      tenantId: tenant._id,
      duration_ms: Date.now() - startTime
    });
  } catch (err) {
    logger.error('TN Webhook error', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId,
      duration_ms: Date.now() - startTime
    });
  }
});

/* -------------------------------------------
 * Ping TN (verificar conexión)
 * GET /api/auth/tn/ping
 * ----------------------------------------- */
router.get('/ping', identifyTenant, async (req, res) => {
  try {
    const tenant = req.tenant;
    if (!tenant.tnIntegration?.accessToken || !tenant.tnIntegration?.connected) {
      return res.status(400).json({
        ok: false,
        error: 'Tenant no vinculado a Tienda Nube'
      });
    }

    const { storeId, accessToken } = tenant.tnIntegration;
    const r = await axios.get(`${TN_API_BASE}/${storeId}/store`, {
      headers: { 'Authentication': `bearer ${accessToken}` }
    });

    return res.json({
      ok: true,
      store_id: storeId,
      store_name: r.data?.name?.es || r.data?.name || '',
      tenant: {
        id: tenant._id,
        name: tenant.companyName
      }
    });
  } catch (err) {
    logger.error('TN ping error', {
      error: err.response?.data || err.message,
      request_id: req.requestId
    });
    return res.status(500).json({
      ok: false,
      error: err.response?.data?.message || err.message
    });
  }
});

/* -------------------------------------------
 * Disconnect TN
 * POST /api/auth/tn/disconnect
 * ----------------------------------------- */
router.post('/disconnect', identifyTenant, async (req, res) => {
  try {
    const tenant = req.tenant;

    // Intentar eliminar el webhook si existe
    if (tenant.tnIntegration?.webhookId && tenant.tnIntegration?.accessToken) {
      try {
        const { storeId, accessToken, webhookId } = tenant.tnIntegration;
        await axios.delete(
          `${TN_API_BASE}/${storeId}/webhooks/${webhookId}`,
          { headers: { 'Authentication': `bearer ${accessToken}` } }
        );
      } catch (e) {
        logger.warn('TN: could not delete webhook on disconnect', {
          error: e.response?.data || e.message
        });
      }
    }

    // Limpiar integración
    await Tenant.findByIdAndUpdate(tenant._id, {
      'tnIntegration.accessToken': null,
      'tnIntegration.webhookId': null,
      'tnIntegration.connected': false
    });

    logger.info('TN disconnected', {
      tenantId: tenant._id,
      tenant_name: tenant.companyName,
      request_id: req.requestId
    });

    return res.json({ ok: true, message: 'Tienda Nube desconectada' });
  } catch (err) {
    logger.error('TN disconnect error', {
      error: err.message,
      stack: err.stack,
      request_id: req.requestId
    });
    return res.status(500).json({ error: 'Error al desconectar TN' });
  }
});

/* -------------------------------------------
 * Status TN
 * GET /api/auth/tn/status
 * ----------------------------------------- */
router.get('/status', identifyTenant, async (req, res) => {
  try {
    const tenant = req.tenant;
    const tn = tenant.tnIntegration || {};

    return res.json({
      connected: !!tn.connected,
      storeId: tn.storeId || null,
      storeName: tn.storeName || null,
      connectedAt: tn.connectedAt || null
    });
  } catch (err) {
    logger.error('TN status error', {
      error: err.message,
      request_id: req.requestId
    });
    return res.status(500).json({ error: 'Error al obtener estado TN' });
  }
});

module.exports = router;
