// models/partidos.js
const mongoose = require('mongoose');

const partidoSchema = new mongoose.Schema({
  codigo_postal: {
    type: String,
    index: true,
    sparse: true
  },
  codigos_postales: [{ type: String }],
  localidad:     { type: String },
  partido:       { type: String, required: true, index: true },
  zona:          { type: String }
}, {
  collection: 'partidos'  // asegúrate que coincide con el nombre real
});

partidoSchema.index({ codigos_postales: 1 });

module.exports = mongoose.models.Partido ||
                   mongoose.model('Partido', partidoSchema);
