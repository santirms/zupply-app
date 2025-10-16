const router = require('express').Router();
const QRCode = require('qrcode');

const Envio = require('../models/Envio');
const Cliente = require('../models/Cliente');
const { buildLabelPDF } = require('../utils/labelService');
const { requireAuth, requireRole } = require('../middlewares/auth');

function generarTracking() {
  const base = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `ZPL-${base}-${rand}`;
}

async function generarTrackingUnico() {
  for (let intentos = 0; intentos < 6; intentos++) {
    const tracking = generarTracking();
    const exists = await Envio.exists({ id_venta: tracking });
    if (!exists) return tracking;
  }
  return `ZPL-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

router.post('/crear', requireAuth, requireRole('admin', 'coordinador', 'cliente'), async (req, res) => {
  try {
    const user = req.session?.user;
    let {
      cliente_id,
      direccion,
      codigo_postal,
      partido,
      destinatario,
      telefono,
      referencia
    } = req.body || {};

    if (user?.role === 'cliente') {
      cliente_id = user.cliente_id;
      if (!cliente_id) {
        return res.status(400).json({ error: 'Usuario sin cliente asociado' });
      }
    }

    if (!cliente_id) {
      return res.status(400).json({ error: 'Debe especificar un cliente' });
    }

    if (!destinatario || !direccion || !codigo_postal) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const cliente = await Cliente.findById(cliente_id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const senderId = cliente.codigo_cliente || (Array.isArray(cliente.sender_id) ? cliente.sender_id[0] : null);
    if (!senderId) {
      return res.status(400).json({ error: 'El cliente no tiene sender_id asignado' });
    }

    const tracking = await generarTrackingUnico();

    const nuevoEnvio = await Envio.create({
      cliente_id: cliente._id,
      sender_id: senderId,
      direccion: direccion.trim(),
      codigo_postal: codigo_postal.trim(),
      partido: partido ? partido.trim() : '',
      destinatario: destinatario.trim(),
      telefono: telefono ? telefono.trim() : '',
      referencia: referencia ? referencia.trim() : '',
      estado: 'en_preparacion',
      requiere_sync_meli: false,
      origen: 'ingreso_manual',
      source: user?.role === 'cliente' ? 'panel_cliente' : 'panel',
      fecha: new Date(),
      id_venta: tracking
    });

    let label_url = null;
    let qr_png = null;

    try {
      const label = await buildLabelPDF(nuevoEnvio.toObject());
      label_url = label?.url || null;
    } catch (err) {
      console.warn('No se pudo generar la etiqueta PDF:', err.message);
    }

    try {
      qr_png = await QRCode.toDataURL(tracking, { width: 256, margin: 0 });
    } catch (err) {
      console.warn('No se pudo generar el QR:', err.message);
    }

    if (label_url || qr_png) {
      await Envio.updateOne({ _id: nuevoEnvio._id }, {
        $set: {
          ...(label_url ? { label_url } : {}),
          ...(qr_png ? { qr_png } : {})
        }
      });
      nuevoEnvio.label_url = label_url;
      nuevoEnvio.qr_png = qr_png;
    }

    console.log(`✓ Envío ${nuevoEnvio._id} creado por ${user?.username || 'usuario'}`);

    return res.json({
      ok: true,
      envio: {
        _id: String(nuevoEnvio._id),
        tracking,
        destinatario: nuevoEnvio.destinatario,
        direccion: nuevoEnvio.direccion,
        codigo_postal: nuevoEnvio.codigo_postal,
        partido: nuevoEnvio.partido,
        telefono: nuevoEnvio.telefono,
        referencia: nuevoEnvio.referencia,
        estado: nuevoEnvio.estado,
        fecha: nuevoEnvio.fecha,
        label_url,
        qr_png
      },
      message: 'Envío creado correctamente'
    });
  } catch (err) {
    console.error('Error creando envío:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
