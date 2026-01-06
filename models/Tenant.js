// models/Tenant.js
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  // Información básica del tenant
  nombre: {
    type: String,
    required: true,
    trim: true
  },

  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },

  // Estado del tenant
  activo: {
    type: Boolean,
    default: true
  },

  // Integración con MercadoLibre
  mlIntegration: {
    // Tokens de OAuth
    accessToken: {
      type: String,
      default: null
    },

    refreshToken: {
      type: String,
      default: null
    },

    // ID de usuario de MercadoLibre
    userId: {
      type: String,
      default: null
    },

    // Información adicional
    nickname: {
      type: String,
      default: null
    },

    // Fecha de expiración del token
    expiresIn: {
      type: Number,
      default: null
    },

    // Fecha de creación/actualización del token
    tokenUpdatedAt: {
      type: Date,
      default: null
    },

    // Estado de la integración
    connected: {
      type: Boolean,
      default: false
    }
  },

  // Configuración específica del tenant
  config: {
    // Auto-ingesta de envíos de ML
    autoIngesta: {
      type: Boolean,
      default: false
    },

    // Lista de precios por defecto
    listaPrecios: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ListaDePrecios',
      default: null
    }
  }

}, { timestamps: true });

// Índices para búsquedas eficientes
tenantSchema.index({ slug: 1 });
tenantSchema.index({ 'mlIntegration.userId': 1 });
tenantSchema.index({ activo: 1 });

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
