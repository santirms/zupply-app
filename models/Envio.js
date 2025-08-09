// models/Envio.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const envioSchema = new mongoose.Schema({
  sender_id:      { type: String, required: true },
  cliente_id:     { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  id_venta:       { type: String, required: true },
  meli_id:        { type: String },   // solo para envíos MeLi; NO guardar "" ni null
  codigo_postal:  { type: String, required: true },
  zona:           { type: String },
  partido:        { type: String },
  fecha:          { type: Date, default: Date.now },
  destinatario:   { type: String, required: true },
  direccion:      { type: String, required: true },
  referencia:     { type: String },
  precio:         { type: Number, default: 0 },
  chofer:         { type: Schema.Types.ObjectId, ref: 'Chofer', default: null },
  zonaAsignada:   { type: Schema.Types.ObjectId, ref: 'Zona',   default: null },
  estado:         { type: String, enum: ['pendiente','asignado'], default: 'pendiente' },
});

// Índice de idempotencia SOLO cuando meli_id exista y no sea vacío:
envioSchema.index(
  { meli_id: 1 },
  { unique: true, partialFilterExpression: { meli_id: { $exists: true, $nin: [null, ""] } } }
);

module.exports = mongoose.model('Envio', envioSchema);
