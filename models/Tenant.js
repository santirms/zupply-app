const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  subdomain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
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
    userId: String,
    accessToken: String,
    refreshToken: String,
    nickname: String,
    expiresIn: Number,
    tokenUpdatedAt: Date,
    connectedAt: Date,
    connected: {
      type: Boolean,
      default: false
    }
  },
  plan: {
    type: String,
    enum: ['basic', 'pro', 'enterprise'],
    default: 'basic'
  },
  settings: {
    brandColor: {
      type: String,
      default: '#FF6B35'
    },
    logo: String,
    companyInfo: {
      email: {
        type: String,
        trim: true,
        lowercase: true
      },
      phone: String,
      address: String
    }
  },
  config: {
    autoIngesta: {
      type: Boolean,
      default: false
    },
    listaPrecios: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ListaDePrecios'
    }
  }
}, { timestamps: true });

tenantSchema.index({ subdomain: 1 }, { unique: true });
tenantSchema.index({ isActive: 1 });
tenantSchema.index({ 'mlIntegration.userId': 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
