const mongoose = require('mongoose');

const clienteSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  codigo_cliente: { type: String }, // si estás usando código interno
  sender_id: { type: [String], default: [] },
  lista_precios: { type: String, default: 'General A' },
  cuit: { type: String },
  razon_social: { type: String },
  condicion_iva: { type: String }, // corregí el nombre para que coincida con el front
  link_vinculacion: { type: String } // si estás guardando esto también
});

module.exports = mongoose.models.Cliente || mongoose.model('Cliente', clienteSchema);

