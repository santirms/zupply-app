// models/Tenant.js
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true
  },
  subdomain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  customDomain: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  mlIntegration: {
    userId: {
      type: String
    },
    accessToken: {
      type: String
    },
    refreshToken: {
      type: String
    },
    connectedAt: {
      type: Date
    }
  },
  plan: {
    type: String,
    enum: ['basic', 'pro', 'enterprise'],
    default: 'basic'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  settings: {
    brandColor: {
      type: String,
      default: '#FF6B35'
    },
    logo: {
      type: String
    },
    companyInfo: {
      email: {
        type: String,
        trim: true,
        lowercase: true
      },
      phone: {
        type: String,
        trim: true
      },
      address: {
        type: String
      }
    }
  }
}, { timestamps: true });

// Índice único en subdomain (ya definido con unique: true en el campo)
// Índice en isActive para queries rápidas
tenantSchema.index({ isActive: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
