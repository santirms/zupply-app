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
      link_vinculacion: req.body.link_vinculacion
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
      link_vinculacion: req.body.link_vinculacion
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

// Borrar
router.delete('/:id', async (req, res) => {
  await Cliente.findByIdAndDelete(req.params.id);
  res.status(204).end();
});

module.exports = router;

