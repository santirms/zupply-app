// services/tnIngest.js
'use strict';

const axios       = require('axios');
const Envio       = require('../models/Envio');
const Cliente     = require('../models/Cliente');
const Zona        = require('../models/Zona');
const detectarZona = require('../utils/detectarZona');
const logger      = require('../utils/logger');

const TN_API_BASE = 'https://api.tiendanube.com/v1';

// ---------- precio por zona ----------
async function precioPorZona(cliente, zonaNombre) {
  try {
    if (!cliente?.lista_precios || !zonaNombre) return 0;
    const zonaDoc = await Zona.findOne({ nombre: zonaNombre }, { _id: 1 });
    if (!zonaDoc) return 0;
    const zp = (cliente.lista_precios.zonas || [])
      .find(z => String(z.zona) === String(zonaDoc._id));
    return zp?.precio ?? 0;
  } catch { return 0; }
}

// ---------- fetch TN order ----------
async function fetchTnOrder(storeId, orderId, accessToken) {
  const url = `${TN_API_BASE}/${storeId}/orders/${orderId}`;
  const startTime = Date.now();

  try {
    const { data } = await axios.get(url, {
      headers: { 'Authentication': `bearer ${accessToken}` }
    });

    logger.info('[TN] Order fetched', {
      orderId,
      storeId,
      duration_ms: Date.now() - startTime
    });

    return data || {};
  } catch (error) {
    logger.error('[TN] Order fetch error', {
      orderId,
      storeId,
      status: error.response?.status,
      error: error.response?.data || error.message,
      duration_ms: Date.now() - startTime
    });
    throw error;
  }
}

// ---------- normalize phone ----------
function normalizarTelefono(phone) {
  if (!phone) return null;
  // Remove non-digits
  let digits = phone.replace(/\D/g, '');
  // Try to normalize to 549XXXXXXXXXX format
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('15')) digits = '11' + digits.slice(2);
  if (digits.length === 10) digits = '549' + digits;
  else if (digits.length === 11 && digits.startsWith('54')) digits = '549' + digits.slice(2);
  // Validate format
  if (/^549\d{9,10}$/.test(digits)) return digits;
  return null;
}

// ---------- main ingest ----------
async function ingestTnOrder({ orderId, storeId, accessToken, tenantId }) {
  // 1) Fetch order from TN
  const order = await fetchTnOrder(storeId, orderId, accessToken);

  // Skip if payment not confirmed
  if (order.payment_status !== 'paid') {
    logger.info('[TN] Skipping unpaid order', { orderId, payment_status: order.payment_status });
    return { skipped: true, reason: 'not_paid', orderId };
  }

  // 2) Check if already ingested
  const existing = await Envio.findOne({ tn_order_id: String(order.id) }).lean();
  if (existing) {
    logger.info('[TN] Order already ingested', { orderId, envio_id: existing._id });
    return { skipped: true, reason: 'already_exists', orderId };
  }

  // 3) Find cliente by tn_store_id or by tenantId
  let cliente = await Cliente.findOne({
    tn_store_id: String(storeId),
    tenantId
  }).populate('lista_precios');

  // Fallback: find first cliente for this tenant
  if (!cliente) {
    cliente = await Cliente.findOne({ tenantId }).populate('lista_precios');
  }

  if (!cliente) {
    logger.warn('[TN] No cliente found for tenant', { tenantId, storeId });
    return { skipped: true, reason: 'no_cliente', orderId };
  }

  // 4) Extract shipping address
  const shipping = order.shipping_address || {};
  const cp        = shipping.zipcode || '';
  const dest      = `${shipping.name || ''} ${shipping.lastname || ''}`.trim() || order.customer?.name || '';
  const street    = shipping.address || '';
  const number    = shipping.number || '';
  const address   = [street, number].filter(Boolean).join(' ').trim();
  const floor     = shipping.floor || null;
  const locality  = shipping.locality || '';
  const ref       = [locality, shipping.between_streets].filter(Boolean).join(' - ');
  const phone     = normalizarTelefono(shipping.phone || order.customer?.phone || '');

  // 5) Detect zona/partido
  const { partido = '', zona: zonaNom = '' } = await detectarZona(cp) || {};
  const precio = await precioPorZona(cliente, zonaNom);

  // 6) Build id_venta from TN order number
  const id_venta = String(order.number || order.id);

  // 7) Create envio
  const envioData = {
    tenantId,
    sender_id:     String(cliente.codigo_cliente || cliente.sender_id?.[0] || ''),
    cliente_id:    cliente._id,
    id_venta,
    tn_order_id:   String(order.id),
    codigo_postal: cp,
    partido,
    zona:          zonaNom,
    destinatario:  dest,
    direccion:     address,
    piso_dpto:     floor,
    referencia:    ref,
    telefono:      phone,
    precio,
    origen:        'tiendanube',
    estado:        'pendiente',
    requiere_sync_meli: false,
    fecha:         new Date(order.paid_at || order.created_at || Date.now())
  };

  const envio = new Envio(envioData);
  await envio.save();

  logger.info('[TN] Order ingested', {
    orderId,
    envio_id: envio._id,
    id_venta,
    tenantId,
    storeId,
    cliente: cliente.nombre,
    zona: zonaNom,
    partido
  });

  return envio.toObject ? envio.toObject() : envio;
}

module.exports = { ingestTnOrder };
