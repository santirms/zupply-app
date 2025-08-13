// routes/escanear.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Zona    = require('../models/Zona');

const detectarZona     = require('../utils/detectarZona');
const { getValidToken } = require('../utils/meliUtils');

// ---------- Escaneo MANUAL (por lector/teclado) ----------
router.post('/manual', async (req, res) => {
  try {
    const {
      cliente_id,               // opcional (si sabés el cliente)
      sender_id,                // si lo usás como código interno
      codigo_postal,
      destinatario,
      direccion,
      referencia,
      id_venta                  // si no viene, generás en front/backend
    } = req.body;

    if (!codigo_postal) {
      return res.status(400).json({ error: 'Falta codigo_postal' });
    }

    // Resolver partido/zona
    const { partido, zona } = await detectarZona(codigo_postal);

    // Resolver cliente (por id o por sender_id interno)
    let cliente = null;
    if (cliente_id) {
      cliente = await Cliente.findById(cliente_id).populate('lista_precios');
    } else if (sender_id) {
      cliente = await Cliente.findOne({ codigo_cliente: sender_id }).populate('lista_precios');
      if (!cliente) {
        // fallback por array de sender_id (ML)
        cliente = await Cliente.findOne({ sender_id }).populate('lista_precios');
      }
    }

    // Calcular precio
    let precio = 0;
    if (cliente?.lista_precios && zona) {
      const zonaDoc = await Zona.findOne({ nombre: zona });
      const hit = (cliente.lista_precios.zonas || [])
        .find(z => String(z.zona) === String(zonaDoc?._id));
      if (hit) precio = hit.precio;
    }

    const envio = await Envio.create({
      meli_id:       null,
      sender_id:     cliente?.codigo_cliente || sender_id || '',
      cliente_id:    cliente?._id || null,
      codigo_postal,
      partido,
      zona,
      destinatario,
      direccion,
      referencia,
      id_venta:      id_venta || Math.random().toString(36).slice(2,10).toUpperCase(),
      precio,
      fecha:         new Date()
    });

    res.json({ ok: true, envio });
  } catch (err) {
    console.error('[escanear/manual] error:', err);
    res.status(500).json({ error: 'No se pudo guardar envío manual' });
  }
});

// ---------- Escaneo MeLi (QR Flex) ----------
router.post('/meli', async (req, res) => {
  try {
    // El QR puede venir como:
    // { id / tracking_id, sender_id, hash_code/hashnumber, ... }
    const raw = req.body || {};
    const meli_id    = String(raw.id || raw.tracking_id || raw.meli_id || '').trim();
    const sender_id  = String(raw.sender_id || '').trim(); // user_id ML del QR
    let   cp         = String(raw.codigo_postal || '').trim();

    if (!meli_id || !sender_id) {
      return res.status(400).json({ error: 'Faltan meli_id o sender_id' });
    }

    // Buscar cliente que tenga ese sender_id (vinculado a ML)
    const cliente = await Cliente.findOne({ sender_id })
      .populate('lista_precios');
    if (!cliente || !cliente.user_id) {
      return res.status(404).json({ error: 'Cliente no vinculado a MeLi' });
    }

    // Si no tenemos CP, pedimos a MeLi
    let destinatario = raw.destinatario;
    let direccion    = raw.direccion;
    let referencia   = raw.referencia;

    if (!cp) {
      const access_token = await getValidToken(cliente.user_id);
      const { data: sh } = await axios.get(
        `https://api.mercadolibre.com/shipments/${meli_id}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      cp          = sh?.receiver_address?.zip_code || '';
      destinatario= destinatario || sh?.receiver_address?.receiver_name || '';
      const street= sh?.receiver_address?.street_name || '';
      const num   = sh?.receiver_address?.street_number || '';
      direccion   = direccion || [street, num].filter(Boolean).join(' ');
      referencia  = referencia || sh?.receiver_address?.comment || '';
    }

    // CP -> partido/zona
    const { partido, zona } = await detectarZona(cp);

    // Calcular precio por lista/ zona
    let precio = 0;
    if (cliente?.lista_precios && zona) {
      const zonaDoc = await Zona.findOne({ nombre: zona });
      const hit = (cliente.lista_precios.zonas || [])
        .find(z => String(z.zona) === String(zonaDoc?._id));
      if (hit) precio = hit.precio;
    }

    // Upsert por meli_id
    await Envio.updateOne(
      { meli_id },
      {
        $setOnInsert: { fecha: new Date() },
        $set: {
          meli_id,
          sender_id:     cliente.codigo_cliente || sender_id, // tu “interno”
          cliente_id:    cliente._id,
          codigo_postal: cp,
          partido,
          zona,
          destinatario:  destinatario || '',
          direccion:     direccion    || '',
          referencia:    referencia   || '',
          precio
        }
      },
      { upsert: true }
    );

    res.json({
      ok: true,
      partido,
      zona,
      precio
    });
  } catch (err) {
    console.error('[escanear/meli] error:', err.response?.data || err.message);
    res.status(500).json({ error: 'No se pudo procesar envío MeLi' });
  }
});

module.exports = router;
