// middlewares/identifyTenant.js
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

/**
 * Middleware para identificar el tenant en cada request
 *
 * Estrategias de identificación (en orden de prioridad):
 * 1. Header X-Tenant-Id
 * 2. Query parameter tenant_id
 * 3. Body parameter tenant_id
 * 4. Subdomain (ej: acme.zupply.tech -> slug: 'acme')
 *
 * Adjunta req.tenant (documento completo) y req.tenantId
 */
async function identifyTenant(req, res, next) {
  try {
    let tenantIdentifier = null;
    let searchField = '_id';

    // 1. Intentar desde header
    if (req.headers['x-tenant-id']) {
      tenantIdentifier = req.headers['x-tenant-id'];
      searchField = '_id';
    }
    // 2. Intentar desde query
    else if (req.query.tenant_id) {
      tenantIdentifier = req.query.tenant_id;
      searchField = '_id';
    }
    // 3. Intentar desde body
    else if (req.body?.tenant_id) {
      tenantIdentifier = req.body.tenant_id;
      searchField = '_id';
    }
    // 4. Intentar desde subdomain
    else {
      const host = req.headers.host || '';
      const parts = host.split('.');

      // Si tiene al menos 3 partes (ej: acme.zupply.tech)
      if (parts.length >= 3) {
        const subdomain = parts[0];
        // Excluir subdomains de infraestructura
        if (!['www', 'api', 'admin', 'app', 'linked'].includes(subdomain)) {
          tenantIdentifier = subdomain;
          searchField = 'slug';
        }
      }
    }

    // Si no se pudo identificar tenant, error
    if (!tenantIdentifier) {
      logger.warn('identifyTenant: No tenant identifier found', {
        headers: req.headers,
        query: req.query,
        path: req.path,
        request_id: req.requestId
      });
      return res.status(400).json({
        error: 'Tenant no especificado',
        message: 'Debe proporcionar tenant_id en header, query o subdomain'
      });
    }

    // Buscar el tenant
    const query = { [searchField]: tenantIdentifier, activo: true };
    const tenant = await Tenant.findOne(query);

    if (!tenant) {
      logger.warn('identifyTenant: Tenant not found', {
        identifier: tenantIdentifier,
        searchField,
        request_id: req.requestId
      });
      return res.status(404).json({
        error: 'Tenant no encontrado',
        identifier: tenantIdentifier
      });
    }

    // Adjuntar tenant al request
    req.tenant = tenant;
    req.tenantId = tenant._id;

    logger.debug('identifyTenant: Tenant identified', {
      tenantId: tenant._id,
      nombre: tenant.nombre,
      slug: tenant.slug,
      request_id: req.requestId
    });

    next();
  } catch (error) {
    logger.error('identifyTenant: Error', {
      error: error.message,
      stack: error.stack,
      request_id: req.requestId
    });
    return res.status(500).json({
      error: 'Error al identificar tenant',
      message: error.message
    });
  }
}

/**
 * Middleware opcional: permite continuar sin tenant
 * Útil para endpoints que pueden o no requerir tenant
 */
async function identifyTenantOptional(req, res, next) {
  try {
    let tenantIdentifier = null;
    let searchField = '_id';

    // Misma lógica de identificación
    if (req.headers['x-tenant-id']) {
      tenantIdentifier = req.headers['x-tenant-id'];
      searchField = '_id';
    } else if (req.query.tenant_id) {
      tenantIdentifier = req.query.tenant_id;
      searchField = '_id';
    } else if (req.body?.tenant_id) {
      tenantIdentifier = req.body.tenant_id;
      searchField = '_id';
    } else {
      const host = req.headers.host || '';
      const parts = host.split('.');
      if (parts.length >= 3) {
        const subdomain = parts[0];
        if (!['www', 'api', 'admin', 'app', 'linked'].includes(subdomain)) {
          tenantIdentifier = subdomain;
          searchField = 'slug';
        }
      }
    }

    // Si no hay tenant, continuar sin error
    if (!tenantIdentifier) {
      req.tenant = null;
      req.tenantId = null;
      return next();
    }

    // Buscar el tenant
    const query = { [searchField]: tenantIdentifier, activo: true };
    const tenant = await Tenant.findOne(query);

    req.tenant = tenant || null;
    req.tenantId = tenant?._id || null;

    next();
  } catch (error) {
    logger.error('identifyTenantOptional: Error', {
      error: error.message,
      stack: error.stack,
      request_id: req.requestId
    });
    // En modo opcional, continuar a pesar del error
    req.tenant = null;
    req.tenantId = null;
    next();
  }
}

module.exports = {
  identifyTenant,
  identifyTenantOptional
};
