// routes/escanear.js
const express = require('express');
const router  = express.Router();
const axios   = require('axios');

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Zona    = require('../models/Zona');

const detectarZona     = require('../utils/detectarZona');
const { getValidToken } = require('../utils/meliUtils');
const { geocodeDireccion } = require('../utils/geocode');

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

    // Geocodificar dirección
    let coordenadas = null;
    if (direccion && partido) {
      try {
        coordenadas = await geocodeDireccion({
          direccion: direccion,
          codigo_postal: codigo_postal,
          partido: partido
        });
        if (coordenadas) {
          console.log(`✓ Geocodificado escaneo manual: ${direccion}, ${partido} → ${coordenadas.lat}, ${coordenadas.lon}`);
        }
      } catch (geoError) {
        console.warn('⚠️ Error geocodificando escaneo manual:', geoError.message);
      }
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
      fecha:         new Date(),
      estado:        'pendiente',
      requiere_sync_meli: false,
      origen:        'ingreso_manual',
      // Coordenadas para el mapa
      latitud: coordenadas?.lat || null,
      longitud: coordenadas?.lon || null,
      destino: {
        partido: partido,
        cp: codigo_postal,
        loc: coordenadas ? {
          type: 'Point',
          coordinates: [coordenadas.lon, coordenadas.lat]
        } : null
      }
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

    // Datos del shipment desde MeLi (para completar información y coordenadas)
    const access_token = await getValidToken(cliente.user_id);
    const { data: sh } = await axios.get(
      `https://api.mercadolibre.com/shipments/${meli_id}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    let destinatario = raw.destinatario || sh?.receiver_address?.receiver_name || '';
    let direccion    = raw.direccion    || '';
    let referencia   = raw.referencia   || '';

    const street = sh?.receiver_address?.street_name || '';
    const num    = sh?.receiver_address?.street_number || '';
    if (!direccion) direccion = [street, num].filter(Boolean).join(' ');
    if (!referencia) referencia = sh?.receiver_address?.comment || '';
    if (!cp) cp = sh?.receiver_address?.zip_code || '';

    // ========== EXTRAER COORDENADAS DE MERCADOLIBRE ==========
    let latitud = null;
    let longitud = null;
    let geocode_source = null;

    if (sh?.receiver_address) {
      const addr = sh.receiver_address;
      const lat = addr.latitude || addr.lat || addr.geolocation?.latitude || null;
      const lon = addr.longitude || addr.lon || addr.lng || addr.geolocation?.longitude || null;

      if (lat && lon) {
        const latNum = Number(lat);
        const lonNum = Number(lon);

        if (
          !isNaN(latNum) && !isNaN(lonNum) &&
          latNum !== 0 && lonNum !== 0 &&
          latNum >= -55.1 && latNum <= -21.7 &&
          lonNum >= -73.6 && lonNum <= -53.5
        ) {
          latitud = latNum;
          longitud = lonNum;
          geocode_source = 'mercadolibre';
          console.log(`📍 Coords de MeLi (scan legacy): ${meli_id}`, { latitud, longitud });
        } else {
          console.warn(`⚠️ Coords inválidas/fuera de Argentina para ${meli_id}:`, { lat: latNum, lon: lonNum });
        }
      }
    }
    // ========== FIN EXTRACCIÓN ==========

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
          sender_id:     cliente.codigo_cliente || sender_id, // tu "interno"
          cliente_id:    cliente._id,
          codigo_postal: cp,
          partido,
          zona,
          destinatario:  destinatario || '',
          direccion:     direccion    || '',
          referencia:    referencia   || '',
          precio,
          ...(latitud !== null && longitud !== null ? {
            latitud,
            longitud,
            geocode_source,
            destino: {
              partido: partido,
              cp: cp,
              loc: {
                type: 'Point',
                coordinates: [longitud, latitud]
              }
            }
          } : {
            destino: {
              partido: partido,
              cp: cp,
              loc: null
            }
          })
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
