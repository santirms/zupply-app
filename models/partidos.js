// models/partidos.js
const mongoose = require('mongoose');

const partidoSchema = new mongoose.Schema({
  codigo_postal: { type: String, required: true, index: true },
  localidad:     { type: String },
  partido:       { type: String, required: true }
}, {
  collection: 'partidos'  // asegúrate que coincide con el nombre real
});

module.exports = mongoose.models.Partido ||
                   mongoose.model('Partido', partidoSchema);
