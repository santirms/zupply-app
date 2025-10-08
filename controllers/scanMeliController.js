// controllers/scanMeliController.js
const QRCode = require('qrcode');
const Envio  = require('../models/Envio');
const QrScan = require('../models/QrScan');
const {
  parseQrPayload, extractKeys,
  getTokenByClienteId, getTokenBySenderId, fetchShipmentFromMeli
} = require('../utils/meliUtils');
const { ensureObject, presignGet } = require('../utils/s3');

exports.scanAndUpsert = async (req, res) => {
  try {
    const { raw_text, cliente_id } = req.body;
    if (!raw_text) return res.status(400).json({ ok:false, error:'raw_text requerido' });

    // --- parseo del QR ---
    const parsed = parseQrPayload(raw_text);
    const { tracking, id_venta, sender_id } = extractKeys(parsed);
    const meli_id = tracking || null;               // en tu UI usás meli_id
    if (!meli_id && !id_venta)
      return res.status(400).json({ ok:false, error:'El QR no trae meli_id/tracking ni id_venta' });

    // --- auth MeLi por cliente_id o por sender_id del QR ---
    let auth;
    try {
      if (cliente_id) {
        const t = await getTokenByClienteId(cliente_id);
        auth = { user_id: t.user_id, cliente: t.cliente };
      } else if (sender_id) {
        const t = await getTokenBySenderId(String(sender_id));
        auth = { user_id: t.cliente.user_id, cliente: t.cliente };
      } else {
        return res.status(400).json({ ok:false, error:'Falta cliente_id o sender_id en el QR' });
      }
    } catch {
      return res.status(400).json({ ok:false, error:'No hay token MeLi para este cliente/sender' });
    }

    const now = new Date();
    const text_hash = (QrScan.hashText ? QrScan.hashText(raw_text) : require('crypto').createHash('sha256').update(raw_text).digest('hex'));
    const render_key = `qr/renders/${text_hash}.png`;

    // --- ¿ya existe el envío? (buscamos por meli_id y por (id_venta+sender_id)) ---
    let envio = null;
    if (meli_id) envio = await Envio.findOne({ meli_id });
    if (!envio && id_venta && sender_id) envio = await Envio.findOne({ id_venta, sender_id });

    // --- generar PNG limpio del QR y subirlo (idempotente) ---
    const png = await QRCode.toBuffer(raw_text, { type: 'png', errorCorrectionLevel: 'M', margin: 2, scale: 8 });
    await ensureObject(render_key, png, 'image/png');

    // --- upsert del QrScan (ligado a envío si existe, si no queda por meli_id) ---
    const qrFilter = envio ? { envio_id: envio._id, text_hash }
                           : (meli_id ? { tracking: meli_id, text_hash } : { text_hash, tracking: null });

    const qrDoc = await QrScan.findOneAndUpdate(
      qrFilter,
      {
        $setOnInsert: {
          envio_id: envio?._id || null,
          tracking: envio?.meli_id || meli_id || null,
          id_venta: id_venta || envio?.id_venta || null,
          sender_id: sender_id || envio?.sender_id || null,
          raw_text,
          text_hash,
          createdAt: now
        },
        $set: { render_key }
      },
      { new: true, upsert: true }
    );

    // --- si NO existe el envío, lo creamos con datos de MeLi ---
    let created = false;
    if (!envio) {
      try {
        const meliShipment = await fetchShipmentFromMeli({
          tracking: meli_id,
          id_venta,
          user_id: auth.user_id
        });

        // ========== EXTRAER COORDENADAS ==========
        let latitud = null;
        let longitud = null;
        let geocode_source = null;

        if (meliShipment?.receiver_address) {
          const addr = meliShipment.receiver_address;
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
              console.log(`📍 Coords de MeLi (scan create): ${meliShipment?.id || tracking}`, { latitud, longitud });
            } else {
              console.warn(`⚠️ Coords inválidas/fuera de Argentina para ${meliShipment?.id || tracking}:`, { lat: latNum, lon: lonNum });
            }
          }
        }
        // ========== FIN EXTRACCIÓN ==========

        const base = {
          // claves de identidad
          sender_id: sender_id || meliShipment?.seller_id || meliShipment?.seller?.id || null,
          id_venta:  id_venta  || meliShipment?.order_id  || meliShipment?.order?.id || null,
          meli_id:   meli_id   || (meliShipment?.id ? String(meliShipment.id) : null),

          // dueño del envío en tu app
          cliente_id: cliente_id || auth.cliente?._id || null,

          // datos útiles
          estado: 'ingresado_por_scan',
          estado_meli: {
            status:    meliShipment?.status    || null,
            substatus: meliShipment?.substatus || null,
          },
          destinatario: meliShipment?.receiver_address?.receiver_name || meliShipment?.buyer?.nickname || null,
          direccion:    meliShipment?.receiver_address?.address_line  || null,
          codigo_postal: meliShipment?.receiver_address?.zip_code     || null,
          latitud,
          longitud,
          geocode_source,

          // meta QR
          qr_meta: {
            last_scan_at: now,
            valid_until:  new Date(now.getTime() + 7*24*60*60*1000),
            last_hash:    text_hash,
            scans:        1
          },
          hist: [{
            at: now, estado: 'ingresado_por_scan', source: 'scan',
            note: 'Alta por escaneo QR + MeLi'
          }],
          source: 'scan'
        };

        const upsertFilter =
          (base.meli_id ? { meli_id: base.meli_id } : null) ||
          (base.id_venta && base.sender_id ? { id_venta: base.id_venta, sender_id: base.sender_id } : null);

        if (!upsertFilter) throw new Error('sin_claves_upsert');

        envio = await Envio.findOneAndUpdate(
          upsertFilter,
          { $setOnInsert: base },
          { new: true, upsert: true }
        );
        created = true;

        // enlazar QrScan huérfanos a este envío
        if (!qrDoc.envio_id) {
          await QrScan.updateMany({ text_hash, envio_id: null }, { $set: { envio_id: envio._id } });
        }
      } catch (e) {
        console.error('MeLi fetch error', e);
        return res.json({
          ok: true, created: false, attachedTo: null, pending: true,
          message: 'QR guardado; MeLi no respondió (se asociará luego).'
        });
      }
    } else {
      // --- si ya existía el envío, solo actualizamos meta QR ---
      const needsCoords = (!envio.latitud || !envio.longitud || envio.geocode_source !== 'mercadolibre');
      if (needsCoords && (meli_id || id_venta)) {
        try {
          const meliShipment = await fetchShipmentFromMeli({ tracking: meli_id, id_venta, user_id: auth.user_id });

          if (meliShipment?.receiver_address) {
            const addr = meliShipment.receiver_address;
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
                console.log(`📍 Coords de MeLi (scan): ${meliShipment?.id || meli_id}`, { latitud: latNum, longitud: lonNum });
                await Envio.updateOne(
                  { _id: envio._id },
                  {
                    $set: {
                      latitud: latNum,
                      longitud: lonNum,
                      geocode_source: 'mercadolibre'
                    }
                  }
                );
                envio.latitud = latNum;
                envio.longitud = lonNum;
                envio.geocode_source = 'mercadolibre';
              } else {
                console.warn(`⚠️ Coords inválidas/fuera de Argentina para ${meliShipment?.id || meli_id}:`, { lat: latNum, lon: lonNum });
              }
            }
          }
        } catch (coordsErr) {
          console.warn('scanAndUpsert: no se pudieron refrescar coords de MeLi:', coordsErr.message);
        }
      }

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

    // --- URL presignada del PNG (1 hora) ---
    const url = await presignGet(render_key, 60 * 60);

    return res.json({
      ok: true,
      created,
      attachedTo: envio ? String(envio._id) : null,
      qr_url: url
    });

  } catch (err) {
    console.error('scanAndUpsert error', err);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
};

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
