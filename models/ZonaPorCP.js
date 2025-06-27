const mongoose = require('mongoose');

const zonaPorCPSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  codigos_postales: { type: [String], required: true }
});

module.exports = mongoose.model('ZonaPorCP', zonaPorCPSchema);
