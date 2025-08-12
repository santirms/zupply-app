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
    const { meli_id, sender_id } = req.body;
    if (!meli_id || !sender_id) {
      return res.status(400).json({ error: 'Faltan meli_id o sender_id' });
    }

    // 1) Cliente por sender_id (array)
    const cliente = await Cliente.findOne({ sender_id: sender_id })
                                 .populate('lista_precios');
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado para ese sender_id' });
    }
    if (!cliente.user_id) {
      return res.status(400).json({ error: 'Cliente no vinculado a MeLi (sin user_id)' });
    }

    // 2) Token válido y datos reales del shipment
    const access_token = await getValidToken(cliente.user_id);
    const { data: sh } = await axios.get(
      `https://api.mercadolibre.com/shipments/${meli_id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    // 3) Campos básicos
    const cp           = sh?.receiver_address?.zip_code || '';
    const destinatario = sh?.receiver_address?.receiver_name || '';
    const calle        = sh?.receiver_address?.street_name || '';
    const numero       = sh?.receiver_address?.street_number || '';
    const direccion    = [calle, numero].filter(Boolean).join(' ');
    const referencia   = sh?.receiver_address?.comment || '';

    // 4) Resolver partido / zona a partir del CP
    const zInfo     = await detectarZona(cp); // <- debe devolver { partido, zona }
    const partido   = zInfo?.partido || '';
    const zonaNom   = zInfo?.zona    || '';

    // 5) Precio desde lista del cliente
    let precio = 0;
    if (zonaNom && cliente.lista_precios) {
      const zonaDoc = await Zona.findOne({ nombre: zonaNom });
      if (zonaDoc) {
        const match = (cliente.lista_precios.zonas || [])
          .find(z => String(z.zona) === String(zonaDoc._id));
        if (match) precio = match.precio;
      }
    }

    // Logs útiles (ver consola del server)
    console.log('[/escanear/meli]',
      { meli_id, cp, partido, zona: zonaNom, precio,
        cliente: cliente.nombre, lista: cliente.lista_precios?.nombre });

    // 6) Upsert por meli_id (idempotente)
    const result = await Envio.updateOne(
      { meli_id: String(meli_id) },
      {
        $setOnInsert: { fecha: new Date() },
        $set: {
          meli_id:       String(meli_id),
          sender_id:     String(cliente.codigo_cliente || cliente.sender_id?.[0] || ''), // tu “código interno”
          cliente_id:    cliente._id,
          codigo_postal: cp,
          partido,
          zona:          zonaNom,
          destinatario,
          direccion,
          referencia,
          precio,
          estado: 'pendiente'
        }
      },
      { upsert: true }
    );

    return res.status(201).json({
      ok: true,
      upserted: !!result.upsertedCount,
      partido,
      zona: zonaNom,
      precio
    });

  } catch (err) {
    console.error('Error /escanear/meli:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Error al obtener o guardar el envío desde MeLi' });
  }
});

module.exports = router;
