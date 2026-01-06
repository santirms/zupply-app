const Tenant = require('../models/Tenant');

/**
 * Middleware para identificar el tenant por subdomain
 * Extrae el subdomain del hostname y busca el tenant en la DB
 */
const identifyTenant = async (req, res, next) => {
  try {
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];

    if (!subdomain) {
      return res.status(400).json({ error: 'No se pudo identificar el tenant' });
    }

    const tenant = await Tenant.findOne({ subdomain, isActive: true });

    if (!tenant) {
      return res.status(403).json({ error: 'Tenant no encontrado o inactivo' });
    }

    req.tenant = tenant;
    req.tenantId = tenant._id;

    next();
  } catch (err) {
    console.error('Error en identifyTenant middleware:', err);
    return res.status(500).json({ error: 'Error identificando tenant' });
  }
};

module.exports = identifyTenant;
