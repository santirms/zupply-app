// controllers/scanMeliController.js
const QRCode = require('qrcode');
const Envio  = require('../models/Envio');
const QrScan = require('../models/QrScan');
const {
  parseQrPayload, extractKeys,
  getTokenByClienteId, getTokenBySenderId, fetchShipmentFromMeli
} = require('../utils/meliUtils');
const { ensureObject, presignGet } = require('../utils/s3');

const MELI_ENRICH_TIMEOUT_MS = 3000;

function cleanString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function joinParts(...parts) {
  const cleaned = parts.map(cleanString).filter(Boolean);
  return cleaned.length ? cleaned.join(' ') : null;
}

function pickFirstString(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function withTimeout(promise, ms, timeoutMessage = 'timeout') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

exports.scanAndUpsert = async (req, res) => {
  try {
    const { raw_text, cliente_id } = req.body;
    if (!raw_text) return res.status(400).json({ ok:false, error:'raw_text requerido' });

    // --- parseo del QR ---
    const parsed = parseQrPayload(raw_text);
    const { tracking, id_venta: rawIdVenta, sender_id: senderIdRaw } = extractKeys(parsed);
    const meli_id = cleanString(tracking) || null;               // en tu UI usás meli_id
    const idVentaFromQr = cleanString(rawIdVenta);
    const senderIdFromQr = cleanString(senderIdRaw);
    if (!meli_id && !idVentaFromQr)
      return res.status(400).json({ ok:false, error:'El QR no trae meli_id/tracking ni id_venta' });

    // --- auth MeLi por cliente_id o por sender_id del QR ---
    let auth;
    try {
      if (cliente_id) {
        const t = await getTokenByClienteId(cliente_id);
        auth = { user_id: t.user_id, cliente: t.cliente };
      } else if (senderIdFromQr) {
        const t = await getTokenBySenderId(String(senderIdFromQr));
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
    if (!envio && idVentaFromQr && senderIdFromQr) envio = await Envio.findOne({ id_venta: idVentaFromQr, sender_id: senderIdFromQr });

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
          id_venta: idVentaFromQr || envio?.id_venta || null,
          sender_id: senderIdFromQr || envio?.sender_id || null,
          raw_text,
          text_hash,
          createdAt: now
        },
        $set: { render_key }
      },
      { new: true, upsert: true }
    );

    // --- si NO existe el envío, lo creamos (enriqueciendo con MeLi si se puede) ---
    let created = false;
    if (!envio) {
      const clienteDoc = auth.cliente || {};
      const clienteSender = Array.isArray(clienteDoc?.sender_id)
        ? clienteDoc.sender_id[0]
        : clienteDoc?.sender_id;

      const qrDestinatario = pickFirstString(
        parsed?.destinatario,
        parsed?.receiver,
        parsed?.receiver_name,
        parsed?.receiverName,
        parsed?.buyer?.nickname,
        parsed?.buyer?.name,
        parsed?.receiver_address?.receiver_name
      );
      const qrDireccion = pickFirstString(
        parsed?.direccion,
        parsed?.address_line,
        parsed?.address,
        parsed?.address1,
        parsed?.receiver_address?.address_line,
        joinParts(parsed?.street_name, parsed?.street_number),
        joinParts(parsed?.receiver_address?.street_name, parsed?.receiver_address?.street_number),
        joinParts(parsed?.address?.street, parsed?.address?.number)
      );
      const qrCodigoPostal = pickFirstString(
        parsed?.codigo_postal,
        parsed?.postal_code,
        parsed?.zip_code,
        parsed?.zip,
        parsed?.cp,
        parsed?.receiver_address?.zip_code,
        parsed?.address?.zip_code
      );
      const qrPartido = pickFirstString(
        parsed?.partido,
        parsed?.localidad,
        parsed?.municipio,
        parsed?.city,
        parsed?.city_name,
        parsed?.locality,
        parsed?.receiver_address?.city?.name,
        parsed?.receiver_address?.locality,
        parsed?.receiver_address?.state?.name
      );
      const qrReferencia = pickFirstString(
        parsed?.referencia,
        parsed?.comment,
        parsed?.receiver_address?.comment
      );

      const envioData = {
        sender_id: pickFirstString(senderIdFromQr, clienteSender, clienteDoc?.codigo_cliente),
        id_venta: pickFirstString(idVentaFromQr),
        meli_id,
        cliente_id: cliente_id || clienteDoc?._id || null,
        codigo_postal: qrCodigoPostal,
        partido: qrPartido,
        destinatario: qrDestinatario,
        direccion: qrDireccion,
        referencia: qrReferencia,
        estado: 'ingresado_por_scan',
        estado_meli: {
          status: null,
          substatus: null,
        },
        latitud: null,
        longitud: null,
        geocode_source: null,
        qr_meta: {
          last_scan_at: now,
          valid_until:  new Date(now.getTime() + 7*24*60*60*1000),
          last_hash:    text_hash,
          scans:        1
        },
        hist: [{
          at: now, estado: 'ingresado_por_scan', source: 'scan',
          note: 'Alta por escaneo QR'
        }],
        source: 'scan'
      };

      let meliShipment = null;
      let enrichedViaMeli = false;

      if (auth.user_id && (meli_id || idVentaFromQr)) {
        try {
          meliShipment = await withTimeout(
            fetchShipmentFromMeli({
              tracking: meli_id,
              id_venta: idVentaFromQr,
              user_id: auth.user_id
            }),
            MELI_ENRICH_TIMEOUT_MS,
            'meli_timeout'
          );
        } catch (meliError) {
          console.warn(`⚠️ No se pudo enriquecer desde MeLi (scan sigue): ${meliError.message}`);
        }
      }

      if (meliShipment) {
        enrichedViaMeli = true;
        envioData.estado_meli = {
          status: meliShipment?.status || null,
          substatus: meliShipment?.substatus || null,
        };

        if (!envioData.sender_id) {
          const shipmentSeller = pickFirstString(meliShipment?.seller_id, meliShipment?.seller?.id);
          envioData.sender_id = pickFirstString(senderIdFromQr, shipmentSeller, clienteSender, clienteDoc?.codigo_cliente);
        }
        if (!envioData.id_venta) {
          envioData.id_venta = pickFirstString(idVentaFromQr, meliShipment?.order_id, meliShipment?.order?.id);
        }
        if (!envioData.meli_id) {
          envioData.meli_id = pickFirstString(meli_id, meliShipment?.id);
        }
        if (!envioData.destinatario) {
          envioData.destinatario = pickFirstString(
            meliShipment?.receiver_address?.receiver_name,
            meliShipment?.buyer?.nickname,
            meliShipment?.buyer?.name
          );
        }
        if (!envioData.direccion) {
          envioData.direccion = pickFirstString(
            meliShipment?.receiver_address?.address_line,
            joinParts(meliShipment?.receiver_address?.street_name, meliShipment?.receiver_address?.street_number)
          );
        }
        if (!envioData.codigo_postal) {
          envioData.codigo_postal = pickFirstString(meliShipment?.receiver_address?.zip_code);
        }
        if (!envioData.referencia) {
          envioData.referencia = pickFirstString(meliShipment?.receiver_address?.comment);
        }
        if (!envioData.partido) {
          envioData.partido = pickFirstString(
            meliShipment?.receiver_address?.city?.name,
            meliShipment?.receiver_address?.state?.name
          );
        }

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
              envioData.latitud = latNum;
              envioData.longitud = lonNum;
              envioData.geocode_source = 'mercadolibre';
              console.log(`📍 Coords de MeLi (scan create): ${meliShipment?.id || meli_id}`, { latitud: latNum, longitud: lonNum });
            } else {
              console.warn(`⚠️ Coords inválidas/fuera de Argentina para ${meliShipment?.id || meli_id}:`, { lat: latNum, lon: lonNum });
            }
          }
        }
      }

      if (!envioData.sender_id) {
        envioData.sender_id = pickFirstString(senderIdFromQr, clienteSender, clienteDoc?.codigo_cliente);
      }
      if (!envioData.id_venta) {
        envioData.id_venta = pickFirstString(idVentaFromQr, meli_id, `scan-${text_hash.slice(0, 12)}`);
      }
      if (!envioData.meli_id) {
        envioData.meli_id = pickFirstString(meli_id);
      }

      envioData.sender_id = cleanString(envioData.sender_id);
      envioData.id_venta = cleanString(envioData.id_venta);
      envioData.meli_id = cleanString(envioData.meli_id);
      envioData.codigo_postal = cleanString(envioData.codigo_postal);
      envioData.partido = cleanString(envioData.partido);
      envioData.destinatario = cleanString(envioData.destinatario);
      envioData.direccion = cleanString(envioData.direccion);
      envioData.referencia = cleanString(envioData.referencia);
      if (!envioData.cliente_id) {
        envioData.cliente_id = clienteDoc?._id || null;
      }

      envioData.hist[0].note = enrichedViaMeli
        ? 'Alta por escaneo QR + MeLi'
        : 'Alta por escaneo QR (sin datos de MeLi)';

      const upsertFilter =
        (envioData.meli_id ? { meli_id: envioData.meli_id } : null) ||
        (envioData.id_venta && envioData.sender_id ? { id_venta: envioData.id_venta, sender_id: envioData.sender_id } : null);

      if (!upsertFilter) throw new Error('sin_claves_upsert');

      envio = await Envio.findOneAndUpdate(
        upsertFilter,
        { $setOnInsert: envioData },
        { new: true, upsert: true }
      );
      created = true;

      // enlazar QrScan huérfanos a este envío
      if (!qrDoc.envio_id) {
        await QrScan.updateMany({ text_hash, envio_id: null }, { $set: { envio_id: envio._id } });
      }
    } else {
      // --- si ya existía el envío, solo actualizamos meta QR ---
      const needsCoords = (!envio.latitud || !envio.longitud || envio.geocode_source !== 'mercadolibre');
      if (needsCoords && (meli_id || idVentaFromQr)) {
        try {
          const meliShipment = await withTimeout(
            fetchShipmentFromMeli({ tracking: meli_id, id_venta: idVentaFromQr, user_id: auth.user_id }),
            MELI_ENRICH_TIMEOUT_MS,
            'meli_timeout'
          );

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
