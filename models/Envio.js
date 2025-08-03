// models/Envio.js
const mongoose = require('mongoose');

const envioSchema = new mongoose.Schema({
  sender_id:      { type: String, required: true },  // ahora contendrá el código interno
  cliente_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Cliente', required: true },
  id_venta:       { type: String, required: true },  // ahora siempre viene lleno
  meli_id:        { type: String },
  codigo_postal:  { type: String, required: true },
  zona:           { type: String },                  // opcional si querés guardar zona física
  partido:        { type: String },                  // <-- nuevo campo
  fecha:          { type: Date, default: Date.now },
  destinatario:   { type: String, required: true },
  direccion:      { type: String, required: true },
  referencia:     { type: String },
  precio: { type: Number, default: 0 }

});

module.exports = mongoose.model('Envio', envioSchema);
