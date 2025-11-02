const mongoose = require('mongoose');

const zonaRackSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  partidos: [{ type: String }],
  activo: { type: Boolean, default: true },
  orden: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ZonaRack', zonaRackSchema);
