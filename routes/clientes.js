// routes/clientes.js
const express = require('express');
const router  = express.Router();
const Cliente = require('../models/Cliente');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar middleware a todas las rutas
router.use(identifyTenant);

// GET todos
router.get('/', async (req, res) => {
  const clientes = await Cliente.find({ tenantId: req.tenantId }).populate('lista_precios');
  res.json(clientes);
});

// GET uno
router.get('/:id', async (req, res) => {
  try {
    const c = await Cliente.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('lista_precios');
    if (!c) return res.status(404).json({ error: 'No existe ese cliente' });
    res.json(c);
  } catch (e) {
    res.status(400).json({ error: 'ID inválido' });
  }
});

// PATCH /api/clientes/:id/auto-ingesta
router.patch('/:id/auto-ingesta', async (req, res) => {
  try {
    const { enabled } = req.body;
    const upd = await Cliente.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { auto_ingesta: !!enabled },
      { new: true }
    );
    if (!upd) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true, auto_ingesta: upd.auto_ingesta });
  } catch (e) {
    console.error('Error toggling auto_ingesta:', e);
    res.status(500).json({ error: 'No se pudo actualizar auto_ingesta' });
  }
});

// POST crear cliente
router.post('/', async (req, res) => {
  try {
    const sids = Array.isArray(req.body.sender_id)
      ? req.body.sender_id.filter(v => !!v)
      : [];
    console.log('POST /clientes sender_id recibidos:', sids);

    const datos = {
      nombre:           req.body.nombre,
      sender_id:        sids,
      lista_precios:    req.body.lista_precios,
      cuit:             req.body.cuit,
      razon_social:     req.body.razon_social,
      condicion_iva:    req.body.condicion_iva,
      horario_de_corte: req.body.horario_de_corte,
      link_vinculacion: req.body.link_vinculacion,
      permisos:         req.body.permisos || {},
      facturacion:      req.body.facturacion || {},
      tenantId:         req.tenantId
    };

    const nuevo = new Cliente(datos);
    await nuevo.save();
    res.status(201).json(nuevo);

  } catch (err) {
    console.error('Error creando cliente:', err);
    const mensaje = err.code === 11000
      ? 'Dato duplicado'
      : err.message;
    res.status(400).json({ error: mensaje });
  }
});

// PUT actualizar cliente
router.put('/:id', async (req, res) => {
  try {
    const sids = Array.isArray(req.body.sender_id)
      ? req.body.sender_id.filter(v => !!v)
      : [];
    console.log('PUT /clientes sender_id recibidos:', sids);

    const datos = {
      nombre:           req.body.nombre,
      sender_id:        sids,
      lista_precios:    req.body.lista_precios,
      cuit:             req.body.cuit,
      razon_social:     req.body.razon_social,
      condicion_iva:    req.body.condicion_iva,
      horario_de_corte: req.body.horario_de_corte,
      link_vinculacion: req.body.link_vinculacion,
      permisos:         req.body.permisos || {},
      facturacion:      req.body.facturacion || {}
    };

    const upd = await Cliente.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      datos,
      { new: true, runValidators: true }
    );
    if (!upd) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(upd);
  } catch (err) {
    console.error('Error actualizando cliente:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET meli-link
router.get('/:id/meli-link', async (req, res) => {
  try {
    const { id }        = req.params;
    const { sender_id } = req.query;

    if (!sender_id) {
      return res.status(400).json({ error: 'Falta sender_id' });
    }

    const cliente = await Cliente.findOne({ _id: id, tenantId: req.tenantId });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const stateRaw  = `${id}|${sender_id}`;
    const state     = encodeURIComponent(stateRaw);
    const redirect  = process.env.MERCADOLIBRE_REDIRECT_URI;

    console.log('ML LINK -> redirect_uri:', redirect);
    console.log('ML LINK -> state:', stateRaw);

    if (!redirect) {
      return res.status(500).json({ error: 'MERCADOLIBRE_REDIRECT_URI no seteado' });
    }

    const url =
      `https://auth.mercadolibre.com/authorization` +
      `?response_type=code` +
      `&client_id=${process.env.MERCADOLIBRE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${state}`;

    return res.json({ url });
  } catch (e) {
    console.error('Error generando meli-link:', e);
    res.status(500).json({ error: 'No se pudo generar el link de vinculación' });
  }
});

module.exports = router;
