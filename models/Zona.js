const mongoose = require('mongoose');

const zonaSchema = new mongoose.Schema({
  nombre: { type: String, required: true, unique: true },
  codigos_postales: [String],
  rango: {
    desde: { type: Number },
    hasta: { type: Number }
  }
});

module.exports = mongoose.model('Zona', zonaSchema);
