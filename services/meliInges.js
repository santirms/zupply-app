const Envio   = require('../models/Envio');
const Zona    = require('../models/Zona');
const { obtenerDatosDeEnvio } = require('../utils/meliUtils'); // usa tus tokens/refresh
const detectarZona = require('../utils/detectarZona');          // tu helper existente
const { mapMeliToInterno } = require('../utils/meliStatus');

// precio por lista del cliente + nombre de zona
async function precioPorZona(cliente, zonaNombre) {
  if (!cliente?.lista_precios || !zonaNombre) return 0;
  const zonaDoc = await Zona.findOne({ nombre: zonaNombre });
  if (!zonaDoc) return 0;
  const match = (cliente.lista_precios.zonas || [])
    .find(zp => String(zp.zona) === String(zonaDoc._id));
  return match?.precio ?? 0;
}

/**
 * Ingesta idempotente por meli_id.
 * Requiere cliente con lista_precios populada (populate en quien lo llama).
 */
async function ingestShipment({ shipmentId, cliente }) {
  if (!shipmentId) throw new Error('shipmentId requerido');
  if (!cliente?.user_id) throw new Error('cliente sin user_id MeLi');

  // 1) Leer shipment desde MeLi con tus utils (refresca token si hace falta)
  const sh = await obtenerDatosDeEnvio(shipmentId, cliente.user_id);

  // 2) Extraer datos
  const cp         = sh?.receiver_address?.zip_code || '';
  const destinat   = sh?.receiver_address?.receiver_name || '';
  const street     = sh?.receiver_address?.street_name || '';
  const number     = sh?.receiver_address?.street_number || '';
  const address    = [street, number].filter(Boolean).join(' ').trim();
  const referencia = sh?.receiver_address?.comment || '';

  // 3) Partido/zona + precio
  const { partido, zona } = await detectarZona(cp); // tu helper devuelve { partido, zona }
  const precio = await precioPorZona(cliente, zona);

  // 4) Estados
  const estado_meli = {
    status: sh.status || null,
    substatus: sh.substatus || null,
    updatedAt: new Date()
  };
  const estado = mapMeliToInterno(sh.status, sh.substatus);

  // 5) Upsert idempotente por meli_id
  await Envio.updateOne(
    { meli_id: String(sh.id) },
    {
      $setOnInsert: { fecha: new Date() },
      $set: {
        meli_id: String(sh.id),
        sender_id: String(cliente.codigo_cliente || cliente.sender_id?.[0] || cliente.user_id),
        cliente_id: cliente._id,
        codigo_postal: cp,
        partido,
        zona,
        destinatario: destinat,
        direccion: address,
        referencia,
        precio,
        estado_meli,
        estado
      }
    },
    { upsert: true }
  );

  // 6) Devolver documento actualizado (opcional)
  return await Envio.findOne({ meli_id: String(sh.id) })
                    .populate({ path: 'chofer', select: 'nombre telefono' })
                    .populate('cliente_id');
}

module.exports = { ingestShipment };
