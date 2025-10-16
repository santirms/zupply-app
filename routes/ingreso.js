const express = require('express');
const router  = express.Router();
const mongoose = require('mongoose');
const Zona    = require('../models/Zona');
const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const QRCode  = require('qrcode');
const { buildLabelPDF } = require('../utils/labelService');

const { requireAuth, requireRole } = require('../middlewares/auth');

// Requiere login para todo este módulo
router.use(requireAuth);

// 🟢 ADMIN, COORDINADOR y CLIENTE pueden crear manualmente (uno o varios)
router.post('/manual', requireRole('admin','coordinador','cliente'), async (req, res) => {
  try {
    const { paquetes } = req.body;
    if (!Array.isArray(paquetes) || !paquetes.length) {
      return res.status(400).json({ error: 'No hay paquetes.' });
    }

    const sessionUser = req.session?.user || {};
    const clientesCache = new Map();

    let clienteSesion = null;
    if (sessionUser.role === 'cliente') {
      const clienteIdSesion = sessionUser.cliente_id || sessionUser.client_id;
      if (!clienteIdSesion) {
        return res.status(400).json({ error: 'Usuario sin cliente asociado' });
      }

      clienteSesion = await Cliente.findById(clienteIdSesion).populate('lista_precios');
      if (!clienteSesion) {
        return res.status(400).json({ error: 'Cliente no encontrado' });
      }

      console.log(`Cliente ${sessionUser.username || sessionUser.email || sessionUser._id} creando ${paquetes.length} envío(s) manual(es)`);
    }

    async function obtenerCliente(id) {
      if (!id) return null;
      const key = id.toString();
      if (clientesCache.has(key)) return clientesCache.get(key);
      const doc = await Cliente.findById(id).populate('lista_precios');
      clientesCache.set(key, doc);
      return doc;
    }

    const results = [];
    for (const p of paquetes) {
      const clienteId = p.cliente_id || p.clienteId;
      const cl = clienteSesion || await obtenerCliente(clienteId);
      if (!cl) throw new Error('Cliente no encontrado');

      const idVenta = (p.id_venta || p.idVenta || '').trim()
        || Math.random().toString(36).substr(2,8).toUpperCase();

      const zonaName = p.zona || p.partido || '';
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

      const envio = await Envio.create({
        cliente_id:    cl._id,
        sender_id:     cl.codigo_cliente || p.sender_id || '',
        destinatario:  p.destinatario,
        direccion:     p.direccion,
        codigo_postal: p.codigo_postal,
        zona:          zonaName,
        partido:       zonaName,
        id_venta:      idVenta,
        referencia:    p.referencia,
        precio:        costo,
        fecha:         new Date(),
        estado:        'en_preparacion',
        requiere_sync_meli: false,
        origen:        'ingreso_manual',
        source:        'panel' // 👈 marca el origen
      });

      // etiqueta + QR
      const { url: label_url } = await buildLabelPDF(envio.toObject());
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
        partido: envio.partido
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

    const docs = paquetes.map(p => ({
      cliente_id:    cliente._id,
      sender_id:     cliente.codigo_cliente,
      destinatario:  p.destinatario      || '',
      direccion:     p.direccion          || '',
      codigo_postal: p.codigo_postal      || p.cp || '',
      zona:          p.zona               || '',
      id_venta:      p.idVenta            || p.id_venta || '',
      referencia:    p.referencia         || '',
      fecha:         new Date(),
      precio:        p.manual_precio      ? Number(p.precio) || 0 : 0,
      estado:        'en_preparacion',
      requiere_sync_meli: false,
      origen:        'ingreso_manual',
      source:        'panel'
    }));

    const inserted = await Envio.insertMany(docs);
    return res.status(201).json({ inserted: inserted.length, docs: inserted });
  } catch (err) {
    console.error('Error POST /ingreso/guardar-masivo:', err);
    return res.status(500).json({ error: 'Error al guardar envíos masivos' });
  }
});

module.exports = router;
