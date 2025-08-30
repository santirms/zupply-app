// routes/meli.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Token   = require('../models/Token');
const Cliente = require('../models/Cliente');
const Envio   = require('../models/Envio');

const { getValidToken } = require('../utils/meliUtils');     // usado en /ping
const { ingestShipment } = require('../services/meliIngest'); // ÚNICA fuente de verdad
const { assertCronAuth } = require('../middlewares/cronAuth');
const { backfillCliente } = require('../services/meliBackfill');

const CLIENT_ID     = process.env.MERCADOLIBRE_CLIENT_ID;
const CLIENT_SECRET = process.env.MERCADOLIBRE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.MERCADOLIBRE_REDIRECT_URI;

/* -------------------------------------------
 * OAuth callback MeLi
 * ----------------------------------------- */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send(renderPage({
      ok: false,
      title: 'Faltan parámetros',
      message: 'No recibimos "code" o "state" en el callback.',
    }));

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

    // Si querés, podés redirigir a tu front:
    // return res.redirect(${process.env.FRONTEND_URL}/oauth-result?status=ok);

    return res
      .status(200)
      .type('html; charset=utf-8')
      .send(renderPage({
        ok: true,
        title: '¡Listo! Cliente vinculado',
        message: 'La autenticación con Mercado Libre fue exitosa y el cliente quedó vinculado.',
        ctaHref: process.env.FRONTEND_URL || '/',
        ctaText: 'Volver a Zupply'
      }));

  } catch (err) {
    console.error('Error en OAuth callback:', err.response?.data || err.message);

    return res
      .status(500)
      .type('html; charset=utf-8')
      .send(renderPage({
        ok: false,
        title: 'Hubo un problema',
        message: 'Ocurrió un error durante el proceso de autenticación. Intentá nuevamente.',
        details: (err.response?.data?.error_description || err.message),
        ctaHref: process.env.FRONTEND_URL || '/',
        ctaText: 'Reintentar'
      }));
  }
});

/** === Vista bonita para el callback ===
 *  Ajustá los colores a los del logo de Zupply:
 *  --brand-1: color principal
 *  --brand-2: color secundario (para el degradado)
 *  --accent : color de acento/botones
 */
function renderPage({ ok, title, message, details, ctaHref = '/', ctaText = 'Continuar' }) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zupply – Autenticación</title>
  <style>
    :root{
      /* TODO: cambiá estos valores por los de tu marca */
      --brand-1: #111827;    /* ej. gris muy oscuro */
      --brand-2: #1f2937;    /* ej. gris oscuro para degradado */
      --accent:  #00c2ff;    /* ej. celeste Zupply (ajustar) */
      --ok:      #22c55e;
      --bad:     #ef4444;
      --text:    #f9fafb;
      --muted:   #cbd5e1;
      --card:    #0b1220cc;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
      background: radial-gradient(1200px 800px at 80% -10%, var(--brand-2), var(--brand-1)) fixed;
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
    }
    .card{
      width: min(640px, 92vw);
      background: var(--card);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 20px;
      padding: 28px 28px 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,.35);
      animation: float .5s ease-out both;
    }
    @keyframes float{from{transform:translateY(10px);opacity:.0}to{transform:translateY(0);opacity:1}}
    .logo{
      display:flex;align-items:center;gap:10px;margin-bottom:14px;
      font-weight:700; letter-spacing:.2px;
    }
    .logo-badge{
      width:36px;height:36px;border-radius:10px;
      background: linear-gradient(135deg, var(--accent), #7dd3fc);
      display:grid;place-items:center;color:#001018;font-weight:900;
    }
    h1{margin:8px 0 4px;font-size:1.6rem}
    p {margin:8px 0 0; line-height:1.5; color:var(--muted)}
    .status{
      display:inline-flex;align-items:center;gap:8px;
      margin:14px 0 8px; padding:8px 12px; border-radius:999px;
      font-weight:600; font-size:.95rem;
      background: rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08);
      color: ${ok ? 'var(--ok)' : 'var(--bad)'};
    }
    .cta{
      margin-top:18px; display:inline-block; text-decoration:none;
      padding:12px 18px; border-radius:12px; font-weight:700;
      background: linear-gradient(135deg, var(--accent), #60a5fa);
      color:#001018; transition: transform .08s ease;
      border: none;
    }
    .cta:active{ transform: translateY(1px) }
    .small{margin-top:10px; font-size:.85rem; color:var(--muted)}
    code{background:rgba(255,255,255,.06); padding:2px 6px; border-radius:6px}
    .okdot,.baddot{
      width:10px;height:10px;border-radius:999px;
      background: ${ok ? 'var(--ok)' : 'var(--bad)'};
      box-shadow: 0 0 10px currentColor;
    }
  </style>
</head>
<body>
  <main class="card" role="main" aria-live="polite">
    <div class="logo">
      <div class="logo-badge">Z</div>
      <div>Zupply</div>
    </div>

    <div class="status">
      <span class="${ok ? 'okdot' : 'baddot'}"></span>
      ${ok ? 'Autenticación exitosa' : 'Autenticación fallida'}
    </div>

    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
   ${details ? `<p class="small">Detalle: <code>${escapeHtml(details)}</code></p>` : ''}
    

    <a class="cta" href="${ctaHref}">${escapeHtml(ctaText)}</a>
    <p class="small">Podés cerrar esta ventana con seguridad.</p>
  </main>
  <script>
    // Si esto se abrió en una ventana emergente, intentá cerrarla:
    if (window.opener && !window.opener.closed) {
      // window.close(); // descomentá si usás popups
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str='') {
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

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
router.post('/sync-pending', assertCronAuth, async (req, res) => {
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
    console.error('backfill cliente error:', err.response?.data || err.message);
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
    console.error('backfill-all error:', err.response?.data || err.message);
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
    console.error('debug/pending-linked', e);
    res.status(500).json({ ok:false, error:'debug failed' });
  }
});


module.exports = router;
