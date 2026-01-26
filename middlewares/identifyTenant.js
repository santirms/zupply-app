// middlewares/identifyTenant.js

const Tenant = require('../models/Tenant');

async function identifyTenant(req, res, next) {
  try {
    const host = req.get('host') || '';
    let subdomain = host.split('.')[0];
    
    // Dominios neutrales (sin tenant) - permitir acceso sin tenant
    if (host === 'tracking.zupply.tech' || subdomain === 'tracking') {
      req.isTrackingDomain = true;
      return next();
    }
    
    // Fallback para localhost
    if (subdomain === 'localhost' || subdomain.includes('localhost:')) {
      subdomain = 'demo';
    }
    
    subdomain = subdomain.split(':')[0].toLowerCase().trim();
    
    const tenant = await Tenant.findOne({ subdomain, isActive: true });
    
    if (!tenant) {
      return res.status(404).json({
        error: 'Tenant no encontrado',
        subdomain,
        host
      });
    }
    
    req.tenant = tenant;
    req.tenantId = tenant._id;
    
    console.log('🏢 Tenant:', tenant.companyName, `(${tenant.subdomain})`);
    
    next();
  } catch (error) {
    console.error('Error identificando tenant:', error);
    return res.status(500).json({
      error: 'Error del servidor',
      message: error.message
    });
  }
}

module.exports = identifyTenant;
