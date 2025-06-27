// models/envio.js
const mongoose = require('mongoose');

const envioSchema = new mongoose.Schema({
  sender_id: { type: String, required: true },
  cliente_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  id_venta: { type: String },
  meli_id: { type: String, required: false }, // CAMBIO: antes decía required: true
  codigo_postal: { type: String, required: true },
  zona: { type: String },
  fecha: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Envio', envioSchema);

