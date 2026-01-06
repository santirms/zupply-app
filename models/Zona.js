const mongoose = require('mongoose');
const tenantPlugin = require('../plugins/tenantPlugin');

const zonaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  partidos: [{ type: String, required: true }],
  tenantId: { type: String, required: true, index: true }
});

zonaSchema.plugin(tenantPlugin);
zonaSchema.index({ tenantId: 1, nombre: 1 });

module.exports = mongoose.models.Zona || mongoose.model('Zona', zonaSchema);

