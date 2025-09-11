// controllers/scanMeliController.js
const QRCode = require('qrcode');
const Envio  = require('../models/Envio');
const QrScan = require('../models/QrScan');
const { getMeliAccessToken, parseQrPayload, extractKeys, fetchShipmentFromMeli } = require('../utils/meliUtils');

const { ensureObject, presignGet } = require('../utils/s3');
const QRCode = require('qrcode');

exports.scanAndUpsert = async (req, res) => {
  try {
    const { raw_text, cliente_id } = req.body;
    if (!raw_text || !cliente_id) return res.status(400).json({ ok:false, error:'raw_text y cliente_id requeridos' });

    const parsed = parseQrPayload(raw_text);
    const { tracking, id_venta, sender_id } = extractKeys(parsed);
    const text_hash = QrScan.hashText(raw_text);
    const now = new Date();

    // 1) ¿Ya existe el envío?
    let envio = null;
    if (tracking) envio = await Envio.findOne({ tracking });
    if (!envio && id_venta && sender_id) envio = await Envio.findOne({ id_venta, sender_id });

    // 2) PNG limpio del QR (subir si no existe)
    const render_key = `qr/renders/${text_hash}.png`;
    const png = await QRCode.toBuffer(raw_text, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
    });
    await ensureObject(render_key, png, 'image/png');

    // 3) Upsert QrScan (linkeado si había envío; si no, por tracking)
    const qrFilter = envio ? { envio_id: envio._id, text_hash }
                           : (tracking ? { tracking, text_hash } : { text_hash, tracking: null });

    const qrDoc = await QrScan.findOneAndUpdate(
      qrFilter,
      {
        $setOnInsert: {
          envio_id: envio?._id || null,
          tracking: envio?.tracking || tracking || null,
          id_venta: id_venta || envio?.id_venta || null,
          sender_id: sender_id || envio?.sender_id || null,
          raw_text, text_hash, createdAt: now,
        },
        $set: { render_key }
      },
      { new: true, upsert: true }
    );

    // 4) Si NO existe el envío, lo creo desde MeLi
    let created = false;
    if (!envio) {
      try {
        const { access_token, user_id } = await getTokenByClienteId(cliente_id);
        const meliShipment = await fetchShipmentFromMeli({ tracking, id_venta, user_id });

        // Mapeo base (ajustá a tu esquema real)
        const base = {
          sender_id: sender_id || meliData?.seller_id || null,
          id_venta:  id_venta  || meliData?.id        || null,
          tracking:  tracking  || meliData?.id        || null, // si tu tracking real viene por otro campo, ajustá
          cliente_id,
          estado: 'ingresado_por_scan',
          estado_meli: {
            status:    meliData?.status    || null,
            substatus: meliData?.substatus || null
          },
          destinatario: meliData?.receiver_address?.receiver_name || meliData?.buyer?.nickname || null,
          direccion:    meliData?.receiver_address?.address_line  || null,
          cp:           meliData?.receiver_address?.zip_code      || null,

          qr_meta: {
            last_scan_at: now,
            valid_until:  new Date(now.getTime() + 7*24*60*60*1000),
            last_hash:    text_hash,
            scans:        1
          },
          hist: [{
            at: now,
            estado: 'ingresado_por_scan',
            source: 'scan',
            note: 'Alta por escaneo QR + MeLi'
          }],
          source: 'scan',
        };

        // Upsert idempotente por claves únicas (evita duplicar si entra auto-ingesta a la vez)
        const upsertFilter =
          (tracking ? { tracking } : null) ||
          (id_venta && sender_id ? { id_venta, sender_id } : null);

        if (!upsertFilter) throw new Error('sin_claves_upsert');

        envio = await Envio.findOneAndUpdate(
          upsertFilter,
          { $setOnInsert: base },
          { new: true, upsert: true }
        );
        created = true;

        // linkear QrScan “huérfano” al nuevo Envio si hacía falta
        if (!qrDoc.envio_id) {
          await QrScan.updateMany({ text_hash, envio_id: null }, { $set: { envio_id: envio._id } });
        }
      } catch (e) {
        // Si la API de MeLi cae, al menos dejamos el QR pendiente 7d y no 500
        return res.json({
          ok: true,
          created: false,
          attachedTo: null,
          pending: true,
          message: 'QR guardado; MeLi no respondió (se asociará luego).'
        });
      }
    } else {
      // 5) Si sí existía el envío, actualizar meta QR
      await Envio.updateOne(
        { _id: envio._id },
        {
          $set: {
            'qr_meta.last_scan_at': now,
            'qr_meta.valid_until':  new Date(now.getTime() + 7*24*60*60*1000),
            'qr_meta.last_hash':    text_hash
          },
          $inc: { 'qr_meta.scans': 1 }
        }
      );
    }

    // 6) Devolver URL presignada para verlo en el modal
    const url = await presignGet(render_key, 60 * 60); // 1h

    return res.json({
      ok: true,
      created,                    // true si se creó el Envío ahora
      attachedTo: envio ? String(envio._id) : null,
      qr_url: url                 // para botón “Ver QR de respaldo”
    });

  } catch (err) {
    console.error('scanAndUpsert error', err);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};

// (Opcional) obtener último QR como imagen presignada
exports.latestQr = async (req, res) => {
  try {
    const scan = await QrScan.findOne({ envio_id: req.params.id }).sort({ createdAt:-1 }).lean();
    if (!scan?.render_key) return res.status(404).json({ ok:false, error:'no_qr' });
    const url = await presignGet(scan.render_key, 60*60);
    res.json({ ok:true, url });
  } catch {
    res.status(500).json({ ok:false, error:'server_error' });
  }
};
