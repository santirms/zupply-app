const mongoose = require('mongoose');
const tenantPlugin = require('../plugins/tenantPlugin');

const listaDePreciosSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  zonas: [
    {
      zona: { type: mongoose.Schema.Types.ObjectId, ref: 'Zona', required: true },
      precio: { type: Number, required: true }
    }
  ],
  fechaCreacion: { type: Date, default: Date.now }
});

// Aplicar plugin multi-tenant
listaDePreciosSchema.plugin(tenantPlugin);

// Índices
listaDePreciosSchema.index({ tenantId: 1, nombre: 1 });

module.exports = mongoose.model('ListaDePrecios', listaDePreciosSchema);
