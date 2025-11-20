const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const Zona    = require('../models/Zona');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const QRCode  = require('qrcode');
const { generarEtiquetaInformativa } = require('../utils/labelService');
const { geocodeDireccion } = require('../utils/geocode');

const { requireAuth, requireRole } = require('../middlewares/auth');

function sanitizeTelefono(rawTelefono) {
  if (rawTelefono === undefined || rawTelefono === null || rawTelefono === '') {
    return null;
  }

  const limpio = String(rawTelefono).trim().replace(/\D/g, '');
  if (!limpio) {
    return null;
  }

  if (limpio.length < 12 || limpio.length > 13 || !limpio.startsWith('549')) {
    throw new Error('Formato de teléfono inválido. Debe ser 549 + código de área + número (ej: 5491123456789)');
  }

  return limpio;
}

// Requiere login para todo este módulo
router.use(requireAuth);

// 🟢 ADMIN y COORDINADOR pueden crear manualmente (uno o varios)
router.post('/manual', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const { paquetes } = req.body;
    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes.' });
    }

    const results = [];
    for (let index = 0; index < paquetes.length; index++) {
      const p = paquetes[index];

      let telefonoLimpio = null;
      try {
        telefonoLimpio = sanitizeTelefono(p.telefono);
      } catch (err) {
        return res.status(400).json({ error: `Paquete #${index + 1}: ${err.message}` });
      }

      const cl = await Cliente.findById(p.cliente_id).populate('lista_precios');
      if (!cl) throw new Error('Cliente no encontrado');

      const idVenta = (p.id_venta || p.idVenta || '').trim()
        || Math.random().toString(36).substr(2,8).toUpperCase();

      const zonaName = p.partido || p.zona || '';

      console.log('Debug paquete:', {
        direccion: p.direccion,
        partido: p.partido,
        zona: p.zona,
        zonaName: zonaName,
        codigo_postal: p.codigo_postal
      });

      let costo = 0;
      if (p.manual_precio) {
        costo = Number(p.precio) || 0;
      } else {
        const zonaDoc = await Zona.findOne({ partidos: zonaName });
        if (zonaDoc && cl.lista_precios) {
          const zp = cl.lista_precios.zonas.find(z =>
            z.zona.toString() === zonaDoc._id.toString()
          );
          costo = zp?.precio ?? 0;
        }
      }

      // Geocodificar dirección
      let coordenadas = null;
      if (p.direccion && zonaName) {  // Solo si hay dirección Y partido
        try {
          coordenadas = await geocodeDireccion({
            direccion: p.direccion,
            codigo_postal: p.codigo_postal,
            partido: zonaName
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado: ${p.direccion}, ${zonaName} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando:', geoError.message);
        }
      } else {
        console.warn('⚠️ No se puede geocodificar: falta dirección o partido');
      }

      const envio = await Envio.create({
        cliente_id:    cl._id,
        sender_id:     cl.codigo_cliente,
        destinatario:  p.destinatario,
        direccion:     p.direccion,
        piso_dpto:     p.piso_dpto || null,
        codigo_postal: p.codigo_postal,
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      idVenta,
        telefono:      telefonoLimpio,
        referencia:    p.referencia,
        precio:        costo,
        fecha:         new Date(),
        estado:        'pendiente',
        requiere_sync_meli: false,
        origen:        'ingreso_manual',
        source:        'panel',
        requiereFirma: p.requiereFirma || false,
        tipo:          p.tipo || 'envio',
        contenido:     p.contenido || null,
        // Cobro en destino
        cobroEnDestino: {
          habilitado: p.cobra_en_destino || false,
          monto: p.cobra_en_destino ? (p.monto_a_cobrar || 0) : 0,
          cobrado: false
        },
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: zonaName,
          cp: p.codigo_postal,
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        }
      });

      // etiqueta + QR
      const pdfBuffer = await generarEtiquetaInformativa(envio.toObject(), envio.cliente_id);

      // Subir a S3 y obtener URL
      const { ensureObject, presignGet } = require('../utils/s3');
      const s3Key = `labels/${envio.id_venta}.pdf`;
      await ensureObject(s3Key, pdfBuffer, 'application/pdf');
      const label_url = await presignGet(s3Key, 86400); // 24 horas

      const qr_png = await QRCode.toDataURL(idVenta, { width: 256, margin: 0 });
      await Envio.updateOne({ _id: envio._id }, { $set: { label_url, qr_png } });

      results.push({
        _id: envio._id.toString(),
        id_venta: idVenta,
        tracking: idVenta,
        label_url,
        qr_png,
        destinatario: envio.destinatario,
        direccion: envio.direccion,
        codigo_postal: envio.codigo_postal,
        partido: envio.partido,
        telefono: telefonoLimpio,
        cliente_id: {
          _id: cl._id,
          nombre: cl.nombre
        }
      });
    }

    return res.status(201).json({ ok: true, total: results.length, docs: results });
  } catch (err) {
    console.error('Error POST /ingreso/manual:', err);
    return res.status(500).json({ error: err.message || 'Error al guardar envíos manuales' });
  }
});

// 🟢 ADMIN y COORDINADOR pueden guardar-masivo (tu handler original)
router.post('/guardar-masivo', requireRole('admin','coordinador'), async (req, res) => {
  try {
    const paquetes = req.body;
    if (!Array.isArray(paquetes) || paquetes.length === 0) {
      return res.status(400).json({ error: 'No hay paquetes para guardar.' });
    }
    const clienteId = paquetes[0].clienteId || paquetes[0].cliente_id;
    const cliente   = await Cliente.findById(clienteId);
    if (!cliente) {
      return res.status(400).json({ error: 'Cliente no encontrado.' });
    }

    const docs = [];
    for (let index = 0; index < paquetes.length; index++) {
      const p = paquetes[index];

      let telefonoLimpio = null;
      try {
        telefonoLimpio = sanitizeTelefono(p.telefono);
      } catch (err) {
        return res.status(400).json({ error: `Paquete #${index + 1}: ${err.message}` });
      }

      const zonaName = p.partido || p.zona || '';

      console.log('Debug paquete:', {
        direccion: p.direccion,
        partido: p.partido,
        zona: p.zona,
        zonaName: zonaName,
        codigo_postal: p.codigo_postal || p.cp
      });

      // Geocodificar dirección
      let coordenadas = null;
      if (p.direccion && zonaName) {  // Solo si hay dirección Y partido
        try {
          coordenadas = await geocodeDireccion({
            direccion: p.direccion,
            codigo_postal: p.codigo_postal || p.cp,
            partido: zonaName
          });
          if (coordenadas) {
            console.log(`✓ Geocodificado: ${p.direccion}, ${zonaName} → ${coordenadas.lat}, ${coordenadas.lon}`);
          }
        } catch (geoError) {
          console.warn('⚠️ Error geocodificando:', geoError.message);
        }
      } else {
        console.warn('⚠️ No se puede geocodificar: falta dirección o partido');
      }

      docs.push({
        cliente_id:    cliente._id,
        sender_id:     cliente.codigo_cliente,
        destinatario:  p.destinatario      || '',
        direccion:     p.direccion          || '',
        piso_dpto:     p.piso_dpto || null,
        codigo_postal: p.codigo_postal      || p.cp || '',
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      p.idVenta            || p.id_venta || '',
        telefono:      telefonoLimpio,
        referencia:    p.referencia         || '',
        fecha:         new Date(),
        precio:        p.manual_precio      ? Number(p.precio) || 0 : 0,
        estado:        'pendiente',
        requiere_sync_meli: false,
        origen:        'ingreso_manual',
        source:        'panel',
        requiereFirma: p.requiereFirma || false,
        tipo:          p.tipo || 'envio',
        contenido:     p.contenido || null,
        // Cobro en destino
        cobroEnDestino: {
          habilitado: p.cobra_en_destino || false,
          monto: p.cobra_en_destino ? (p.monto_a_cobrar || 0) : 0,
          cobrado: false
        },
        // Coordenadas para el mapa
        latitud: coordenadas?.lat || null,
        longitud: coordenadas?.lon || null,
        destino: {
          partido: zonaName,
          cp: p.codigo_postal || p.cp || '',
          loc: coordenadas ? {
            type: 'Point',
            coordinates: [coordenadas.lon, coordenadas.lat]
          } : null
        }
      });
    }

    const inserted = await Envio.insertMany(docs);
    return res.status(201).json({ inserted: inserted.length, docs: inserted });
  } catch (err) {
    console.error('Error POST /ingreso/guardar-masivo:', err);
    return res.status(500).json({ error: 'Error al guardar envíos masivos' });
  }
});

module.exports = router;
