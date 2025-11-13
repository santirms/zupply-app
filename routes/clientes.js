// routes/clientes.js
const express = require('express');
const router  = express.Router();
const Cliente = require('../models/Cliente');

// GET todos
router.get('/', async (req, res) => {
  const clientes = await Cliente.find().populate('lista_precios');
  res.json(clientes);
});

// GET uno
router.get('/:id', async (req, res) => {
  try {
    const c = await Cliente.findById(req.params.id).populate('lista_precios');
    if (!c) return res.status(404).json({ error: 'No existe ese cliente' });
    res.json(c);
  } catch (e) {
    res.status(400).json({ error: 'ID inválido' });
  }
});

// PATCH /api/clientes/:id/auto-ingesta
router.patch('/:id/auto-ingesta', async (req, res) => {
  try {
    const { enabled } = req.body; // true/false
    const upd = await Cliente.findByIdAndUpdate(
      req.params.id,
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


// Crear
// routes/clientes.js
router.post('/', async (req, res) => {
  try {
    // 1) limpiar sender_id
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
      permisos:         req.body.permisos || {}
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
      permisos:         req.body.permisos || {}
    };

    const upd = await Cliente.findByIdAndUpdate(
      req.params.id,
      datos,
      { new: true, runValidators: true }
    );
    res.json(upd);
  } catch (err) {
    console.error('Error actualizando cliente:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/clientes/:id/meli-link
router.get('/:id/meli-link', (req, res) => {
  try {
    const { id }        = req.params;
    const { sender_id } = req.query;

    if (!sender_id) {
      return res.status(400).json({ error: 'Falta sender_id' });
    }

    const stateRaw  = `${id}|${sender_id}`;
    const state     = encodeURIComponent(stateRaw);
    const redirect  = process.env.MERCADOLIBRE_REDIRECT_URI;

    // DEBUG rápido (podés quitarlo luego)
    console.log('ML LINK -> redirect_uri:', redirect);
    console.log('ML LINK -> state:', stateRaw);

    if (!redirect) {
      return res.status(500).json({ error: 'MERCADOLIBRE_REDIRECT_URI no seteado' });
    }

    // Usa el host global
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

