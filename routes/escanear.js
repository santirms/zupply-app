// routes/escanear.js

const express = require('express');
const router = express.Router();
const axios = require('axios');
const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const detectarZona = require('../utils/detectarZona');
const { getValidToken } = require('../utils/meliUtils');


// 🔹 Ruta para escaneo manual (cliente no vinculado a MeLi)
router.post('/manual', async (req, res) => {
  // ... tu lógica actual
});

// 🔹 Ruta para escaneo automático con integración MeLi
router.post('/meli', async (req, res) => {
  try {
    const body = req.body || {};

    // Normalizamos campos del QR
    const senderId = String(body.sender_id ?? '').trim();
    const meliId   = String(
      body.meli_id ?? body.tracking_id ?? body.id ?? ''
    ).trim();

    if (!senderId || !meliId) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Faltan sender_id o tracking_id'
      });
    }

    // Busco el cliente por user_id o por el sender_id guardado (array)
    const cliente = await Cliente.findOne({
      $or: [{ user_id: senderId }, { sender_id: senderId }]
    }).populate('lista_precios');

    if (!cliente) {
      return res.status(404).json({
        error: 'client_not_found',
        message: `No existe cliente con sender_id/user_id ${senderId}`
      });
    }

    // Token válido (se refresca si hace falta)
    const accessToken = await getValidToken(cliente.user_id || senderId);

    // Shipment de MeLi
    const { data: sh } = await axios.get(
      `https://api.mercadolibre.com/shipments/${meliId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // Datos de destino
    const cp         = sh?.receiver_address?.zip_code || '';
    const destinat   = sh?.receiver_address?.receiver_name || '';
    const street     = sh?.receiver_address?.street_name || '';
    const number     = sh?.receiver_address?.street_number || '';
    const address    = [street, number].filter(Boolean).join(' ');
    const referencia = sh?.receiver_address?.comment || '';

    // Partido / zona
    const zInfo   = await detectarZona(cp);         // { partido, zona }
    const partido = zInfo?.partido || '';
    const zonaNom = zInfo?.zona    || '';

    // Precio por lista del cliente + zona
    let precio = 0;
    if (cliente.lista_precios && zonaNom) {
      const zonaDoc = await Zona.findOne({ nombre: zonaNom });
      const zp = cliente.lista_precios?.zonas?.find(
        z => String(z.zona) === String(zonaDoc?._id)
      );
      if (zp) precio = zp.precio;
    }

    // Upsert por meli_id (idempotente)
    await Envio.updateOne(
      { meli_id: meliId },
      {
        $setOnInsert: { fecha: new Date() },
        $set: {
          meli_id:       meliId,
          sender_id:     String(cliente.codigo_cliente || cliente.sender_id?.[0] || senderId),
          cliente_id:    cliente._id,
          codigo_postal: cp,
          partido,
          zona:          zonaNom,
          destinatario:  destinat,
          direccion:     address,
          referencia,
          precio
        }
      },
      { upsert: true }
    );

    return res.json({
      ok: true,
      meli_id: meliId,
      partido,
      zona: zonaNom,
      precio
    });

  } catch (err) {
    console.error('[/escanear/meli] error:',
      err.response?.status, err.response?.data || err.message);

    return res.status(500).json({
      error: 'meli_fetch',
      message: 'Error al obtener o guardar el envío desde MeLi',
      details: err.response?.data || err.message
    });
  }
});

module.exports = router;
