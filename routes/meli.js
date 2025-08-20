// routes/meli.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Token   = require('../models/Token');
const Cliente = require('../models/Cliente');
const Envio   = require('../models/Envio');
const Zona    = require('../models/Zona');

const { getValidToken } = require('../utils/meliUtils');
const detectarZona      = require('../utils/detectarZona');
const { mapMeliToInterno } = require('../utils/meliStatus');

const CLIENT_ID     = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.MERCADOLIBRE_REDIRECT_URI;

/* -------------------------------------------
 * Helper: precio por lista/cliente y zona nombre
 * ----------------------------------------- */
async function precioPorZona(cliente, zonaNombre) {
  if (!cliente?.lista_precios || !zonaNombre) return 0;
  const zonaDoc = await Zona.findOne({ nombre: zonaNombre });
  if (!zonaDoc) return 0;
  const match = (cliente.lista_precios.zonas || [])
    .find(zp => String(zp.zona) === String(zonaDoc._id));
  return match?.precio ?? 0;
}

/* -------------------------------------------
 * OAuth callback MeLi
 * ----------------------------------------- */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Faltan parámetros en callback');
    }

    // Intercambio code -> tokens
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

    // Guardar/actualizar tokens
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

    return res.json({
      ok: true,
      user_id: r.data.id,
      nickname: r.data.nickname,
    });
  } catch (err) {
    console.error('Ping token error:', err.response?.data || err.message);
    return res.status(500).json({ ok:false, error: err.response?.data?.message || err.message });
  }
});

/* -------------------------------------------
 * Webhook de notificaciones (topic: shipments)
 * POST /api/auth/meli/webhook
 * ----------------------------------------- */
router.post('/webhook', async (req, res) => {
  try {
    // Mercado Libre envía { user_id, resource: "/shipments/123", topic: "shipments", ... }
    const { user_id, resource, topic } = req.body || {};

    // Responder rápido para evitar reintentos
    res.status(200).json({ ok: true });

    if (topic !== 'shipments' || !resource || !user_id) return;

    // Cliente por user_id
    const cliente = await Cliente.findOne({ user_id }).populate('lista_precios');
    if (!cliente) return;
    if (!cliente.auto_ingesta) return; // sólo si está habilitado

    // Token válido
    const access_token = await getValidToken(user_id);

    // ID del envío
    const shipmentId = String(resource.split('/').pop());

    // Detalle del shipment
    const { data: sh } = await axios.get(
      `https://api.mercadolibre.com/shipments/${shipmentId}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const cp         = sh?.receiver_address?.zip_code || '';
    const destinat   = sh?.receiver_address?.receiver_name || '';
    const street     = sh?.receiver_address?.street_name || '';
    const number     = sh?.receiver_address?.street_number || '';
    const address    = [street, number].filter(Boolean).join(' ').trim();
    const referencia = sh?.receiver_address?.comment || '';

    // Partido / zona
    const zInfo    = await detectarZona(cp); // { partido, zona }
    const partido  = zInfo?.partido || '';
    const zonaNom  = zInfo?.zona    || '';

    // Precio por lista del cliente
    const precio   = await precioPorZona(cliente, zonaNom);

const estado_meli = {
  status:    sh.status || null,
  substatus: sh.substatus || null,
  updatedAt: new Date()
};
const estado_interno = mapMeliToInterno(sh.status, sh.substatus);

// Upsert por meli_id (idempotente)
await Envio.updateOne(
  { meli_id: String(sh.id) },
  {
    $setOnInsert: { fecha: new Date() },
    $set: {
      meli_id:       String(sh.id),
      sender_id:     String(cliente.codigo_cliente || cliente.sender_id?.[0] || user_id),
      cliente_id:    cliente._id,
      codigo_postal: cp,
      partido,
      zona:          zonaNom,
      destinatario:  destinat,
      direccion:     address,
      referencia,
      precio,
      estado_meli,
      estado: estado_interno
    }
  },
  { upsert: true }
);
    
  } catch (err) {
    console.error('Webhook ML error:', err.response?.data || err.message);
    // Ya respondimos 200; no relanzamos error
  }
});

// Forzar sync de un envío puntual por meli_id (útil para probar desde UI/Postman)
router.post('/force-sync/:meli_id', async (req, res) => {
  try {
    const meli_id = String(req.params.meli_id);
    const envio = await Envio.findOne({ meli_id }).populate('cliente_id');
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const user_id = envio.cliente_id?.user_id;
    if (!user_id) return res.status(400).json({ error: 'Cliente sin user_id MeLi' });

    const access_token = await getValidToken(user_id);
    const { data: sh } = await axios.get(
      `https://api.mercadolibre.com/shipments/${meli_id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const cp         = sh?.receiver_address?.zip_code || '';
    const destinat   = sh?.receiver_address?.receiver_name || '';
    const street     = sh?.receiver_address?.street_name || '';
    const number     = sh?.receiver_address?.street_number || '';
    const address    = [street, number].filter(Boolean).join(' ').trim();
    const referencia = sh?.receiver_address?.comment || '';

    const zInfo    = await detectarZona(cp);
    const partido  = zInfo?.partido || '';
    const zonaNom  = zInfo?.zona    || '';

    const precio = await (async () => {
      if (!envio.cliente_id?.lista_precios || !zonaNom) return 0;
      const zonaDoc = await Zona.findOne({ nombre: zonaNom });
      if (!zonaDoc) return 0;
      const item = envio.cliente_id.lista_precios.zonas.find(z => String(z.zona) === String(zonaDoc._id));
      return item?.precio ?? 0;
    })();

    const estado_meli = { status: sh.status || null, substatus: sh.substatus || null, updatedAt: new Date() };
    const estado_interno = mapMeliToInterno(sh.status, sh.substatus);

    await Envio.updateOne(
      { meli_id },
      {
        $set: {
          codigo_postal: cp,
          partido, zona: zonaNom,
          destinatario: destinat,
          direccion: address,
          referencia,
          precio,
          estado_meli,
          estado: estado_interno
        }
      }
    );

    const updated = await Envio.findOne({ meli_id });
    res.json({ ok: true, envio: updated });
  } catch (err) {
    console.error('force-sync error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error al sincronizar' });
  }
});

// Sync masivo (para cron/worker): actualiza no terminales
router.post('/sync-pending', async (req, res) => {
  try {
    const TERMINALES = new Set(['delivered','cancelled']);

    const pendientes = await Envio.find({
      meli_id: { $ne: null },
      $or: [
        { 'estado_meli.status': { $nin: Array.from(TERMINALES) } },
        { estado: { $nin: ['entregado','cancelado'] } },
      ]
    }).limit(100);

    let ok = 0, fail = 0;
    for (const e of pendientes) {
      try {
        const cliente = await Cliente.findById(e.cliente_id);
        if (!cliente?.user_id) { fail++; continue; }
        const access_token = await getValidToken(cliente.user_id);
        const { data: sh } = await axios.get(
          `https://api.mercadolibre.com/shipments/${e.meli_id}`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );

        const estado_meli = { status: sh.status || null, substatus: sh.substatus || null, updatedAt: new Date() };
        const estado_interno = mapMeliToInterno(sh.status, sh.substatus);

        await Envio.updateOne(
          { _id: e._id },
          { $set: { estado_meli, estado: estado_interno } }
        );
        ok++;
      } catch (err) {
        fail++;
        console.error('sync item error:', e._id, err.response?.data || err.message);
      }
      await new Promise(r => setTimeout(r, 150)); // rate-limit suave
    }
    res.json({ ok, fail, total: pendientes.length });
  } catch (err) {
    console.error('sync-pending error:', err);
    res.status(500).json({ error: 'Error en sync-pending' });
  }
});

module.exports = router;
