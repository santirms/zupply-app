// models/Tenant.js
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  subdomain: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  cliente_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cliente'
  },
  configuracion: {
    zona_horaria: {
      type: String,
      default: 'America/Argentina/Buenos_Aires'
    }
  }
}, { timestamps: true });

// Índice compuesto para búsquedas rápidas por subdomain activo
tenantSchema.index({ subdomain: 1, isActive: 1 });

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
