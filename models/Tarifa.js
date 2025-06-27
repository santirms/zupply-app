const mongoose = require('mongoose');

const tarifaSchema = new mongoose.Schema({
  zona_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Zona', required: true },
  lista_precios: { type: String, required: true },
  valor: { type: Number, required: true }
});

module.exports = mongoose.model('Tarifa', tarifaSchema);