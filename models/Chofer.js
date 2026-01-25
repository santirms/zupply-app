// models/Chofer.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantPlugin = require('../plugins/tenantPlugin');

const ChoferSchema = new Schema({
  nombre:   { type: String, required: true },
  telefono: { type: String, required: true }
}, {
  timestamps: true
});

// Aplicar plugin de tenant
ChoferSchema.plugin(tenantPlugin);

// Índices para búsquedas eficientes
ChoferSchema.index({ tenantId: 1, nombre: 1 });

module.exports = mongoose.model('Chofer', ChoferSchema);
