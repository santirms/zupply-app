// models/QrScan.js
const mongoose = require('mongoose');
const crypto = require('crypto');

const QrScanSchema = new mongoose.Schema({
  envio_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Envio', index: true, default: null },
  tracking:   { type: String, index: true, default: null },
  id_venta:   { type: String, index: true, default: null },
  sender_id:  { type: String, index: true, default: null },

  raw_text:   { type: String, required: true },
  text_hash:  { type: String, required: true, index: true },

  render_key: { type: String, index: true, default: null }, // p.ej. "qr/renders/<hash>.png"
  createdAt:  { type: Date, default: Date.now, index: true },
});

// TTL: 7 días
QrScanSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

// Dedupe por contenido
QrScanSchema.index({ envio_id: 1, text_hash: 1 }, { unique: true, sparse: true });
QrScanSchema.index({ tracking: 1, text_hash: 1 }, { unique: true, sparse: true });

QrScanSchema.statics.hashText = (txt) =>
  crypto.createHash('sha256').update(txt).digest('hex');

module.exports = mongoose.model('QrScan', QrScanSchema);
