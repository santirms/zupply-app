const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    subdomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    name: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Tenant', tenantSchema);
// models/Tenant.js
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
    connectedAt: Date
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
    logo: String,
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
      address: String
    }
  }
}, { timestamps: true });

tenantSchema.index({ subdomain: 1 }, { unique: true });
tenantSchema.index({ isActive: 1 });

module.exports = mongoose.model('Tenant', tenantSchema);
