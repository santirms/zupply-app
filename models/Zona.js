const mongoose = require('mongoose');

const zonaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  partidos: [{ type: String, required: true }]
});

module.exports = mongoose.models.Zona || mongoose.model('Zona', zonaSchema);

