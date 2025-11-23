// services/meliSync.js
const axios = require('axios');
const Cliente = require('../models/Cliente');
const Envio   = require('../models/Envio');
const { getValidToken } = require('../utils/meliUtils');
const { mapMeliToInterno } = require('../utils/meliStatus');
const { ensureMeliHistory } = require('./meliHistory');
const logger = require('../utils/logger');

async function syncPendingShipments({ limit = 200, delayMs = 120 } = {}) {
  // 1) Traigo los clientes que TIENEN user_id (vinculados a MeLi)
  const clientesVinc = await Cliente.find(
    { user_id: { $exists: true, $ne: null } },
    { _id: 1, user_id: 1, nombre: 1, codigo_cliente: 1, sender_id: 1 }
  );

  const clientsById = new Map(clientesVinc.map(c => [String(c._id), c]));
  const idsVinc = clientesVinc.map(c => c._id);

  // 2) Filtrar envíos: solo de clientes vinculados + no terminales
  const hace48Horas = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const pendientes = await Envio.find({
    meli_id: { $ne: null },
    cliente_id: { $in: idsVinc },
    $or: [
      // No terminales
      {
        $and: [
          { estado: { $nin: ['entregado', 'cancelado'] } },
          { 'estado_meli.status': { $nin: ['delivered', 'cancelled'] } }
        ]
      },
      // Delivered reciente SIN delivered en historial
      {
        $and: [
          { 'estado_meli.status': 'delivered' },
          { 'estado_meli.updatedAt': { $gte: hace48Horas } },
          // NO tiene delivered en el historial
          { 'historial.estado_meli.status': { $ne: 'delivered' } }
        ]
      },
      // Sin estado (legacy)
      { estado: { $exists: false } }
    ]
  })
  .limit(limit);

  let ok = 0, fail = 0, skipped_no_user = 0, skipped_no_meli_id = 0, errors_api = 0;

  // 3) Métricas de diagnóstico (útiles para entender “por qué 54”)
  const totalAll = await Envio.countDocuments({ meli_id: { $ne: null } });
  const totalOfLinkedClients = await Envio.countDocuments({
    meli_id: { $ne: null }, cliente_id: { $in: idsVinc }
  });
  logger.info('[meliSync] diag', {
    enviosConMeliId: totalAll,
    deClientesVinculados: totalOfLinkedClients,
    clientesVinculados: clientesVinc.length
  });

  // 4) Si no hay pendientes de clientes vinculados, corto rápido (evita “54” inútiles)
  if (!pendientes.length) {
    return { total: 0, ok, fail, skipped_no_user, skipped_no_meli_id, errors_api };
  }

  for (const e of pendientes) {
    try {
      const meli_id = e.meli_id;
      if (!meli_id) { skipped_no_meli_id++; continue; }

      // Cliente vinculado para este envío
      let cliente = clientsById.get(String(e.cliente_id));
      if (!cliente) {
        // Intento re-vincular por sender_id (codigo_cliente o sender_id de ML)
        cliente = await Cliente.findOne({
          $or: [
            { codigo_cliente: e.sender_id },
            { sender_id: e.sender_id } // array o string
          ],
          user_id: { $exists: true, $ne: null }
        }, { _id:1, user_id:1, nombre:1 });

        if (cliente) {
          // Persiste el cliente_id si faltaba
          await Envio.updateOne({ _id: e._id }, { $set: { cliente_id: cliente._id } });
          clientsById.set(String(cliente._id), cliente);
        }
      }

      if (!cliente?.user_id) {
        skipped_no_user++;
        logger.warn('[meliSync] skipped_no_user', {
          envio_id: e._id.toString(),
          cliente_id: e.cliente_id?.toString?.()
        });
        continue;
      }

      // Pido estado actual a MeLi
      const access_token = await getValidToken(cliente.user_id);
      const url = `/shipments/${meli_id}`;
      const startTime = Date.now();
      let sh;

      try {
        const response = await axios.get(
          `https://api.mercadolibre.com${url}`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        sh = response.data;
        logger.ml('Shipment sync fetched', meli_id, {
          status: response.status,
          duration_ms: Date.now() - startTime
        });
      } catch (error) {
        logger.api(
          'MercadoLibre',
          'GET',
          url,
          error.response?.status || 0,
          Date.now() - startTime
        );
        throw error;
      }

      const estado_meli = {
        status:    sh?.status || null,
        substatus: sh?.substatus || null,
        updatedAt: new Date()
      };
      const estado_interno = mapMeliToInterno(sh?.status, sh?.substatus);

      await Envio.updateOne(
        { _id: e._id },
        {
          $set: {
            estado_meli,
            estado: estado_interno,
            ml_status: sh?.status || null,
            ml_substatus: sh?.substatus || null
          }
        }
      );

      // AGREGAR: Hidratar historial desde MeLi
      try {
        await ensureMeliHistory(e, { force: false });
      } catch (histErr) {
        logger.warn('[meliSync] ensureMeliHistory falló', {
          meli_id: e.meli_id,
          error: histErr.message
        });
      }

      ok++;
    } catch (err) {
      errors_api++;
      fail++;
      logger.error('[meliSync] sync item error', {
        envio_id: e._id.toString(),
        meli_id: e.meli_id,
        error: err?.response?.data || err.message
      });
    }
    // rate limit suave
    await new Promise(r => setTimeout(r, delayMs));
  }

  const resumen = { total: pendientes.length, ok, fail, skipped_no_user, skipped_no_meli_id, errors_api };
  logger.info('[meliSync] resumen', resumen);

  return resumen;
}

module.exports = { syncPendingShipments };
