// models/Asignacion.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const asignacionEnvioSchema = new Schema({
  // Si el envío existe en la base
  envio:         { type: Schema.Types.ObjectId, ref: 'Envio', required: false },
  // Si NO existe: guardamos el tracking "crudo"
  tracking:      { type: String, index: true },
  externo:       { type: Boolean, default: false }, // marcamos placeholder
  id_venta:      { type: String },
  meli_id:       { type: String },
  cliente_id:    { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  destinatario:  { type: String },
  direccion:     { type: String },
  codigo_postal: { type: String },
  partido:       { type: String },
  precio:        { type: Number }
}, { _id: false });

const asignacionSchema = new Schema({
  chofer:          { type: Schema.Types.ObjectId, ref: 'Chofer', required: true },
  zona:            { type: String }, // opcional: no se usa en PDF/WA si guardás lista_nombre
  lista_chofer_id: { type: Schema.Types.ObjectId, ref: 'ListaDePrecios' },
  lista_nombre:    { type: String, default: '' }, // ej: "Choferes Zona 1"

  envios:          [asignacionEnvioSchema],
  total_paquetes:  { type: Number, default: 0 },
  remito_url:      { type: String },
  fecha:           { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.Asignacion || mongoose.model('Asignacion', asignacionSchema);

