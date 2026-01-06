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
/**
 * Middleware para identificar el tenant de la solicitud
 *
 * Identifica el tenant basándose en (en orden de prioridad):
 * 1. Header X-Tenant-ID
 * 2. Subdomain (ej: tenant1.miapp.com -> tenant1)
 * 3. Query parameter ?tenant=xxx
 * 4. Default tenant (si está configurado)
 *
 * Agrega req.tenantId para uso en controladores
 */

function identifyTenant(req, res, next) {
  let tenantId = null;

  // 1. Verificar header personalizado
  if (req.headers['x-tenant-id']) {
    tenantId = req.headers['x-tenant-id'];
  }

  // 2. Verificar subdomain
  else if (req.hostname) {
    const parts = req.hostname.split('.');
    // Si hay subdomain (ej: tenant1.miapp.com)
    if (parts.length > 2) {
      const subdomain = parts[0];
      // Ignorar subdomains comunes
      if (!['www', 'api', 'admin'].includes(subdomain.toLowerCase())) {
        tenantId = subdomain;
      }
    }
  }

  // 3. Verificar query parameter
  if (!tenantId && req.query.tenant) {
    tenantId = req.query.tenant;
  }

  // 4. Usar tenant por defecto si está configurado
  if (!tenantId && process.env.DEFAULT_TENANT_ID) {
    tenantId = process.env.DEFAULT_TENANT_ID;
  }

  // Si no se pudo identificar el tenant, retornar error
  if (!tenantId) {
    return res.status(400).json({
      error: 'No se pudo identificar el tenant. Proporcione X-Tenant-ID header, subdomain, o ?tenant= parameter'
    });
  }

  // Agregar tenantId al request
  req.tenantId = String(tenantId).trim();

  next();
// Este middleware identifica el tenant del usuario autenticado
// y lo establece en req.tenantId para filtrado automático

function identifyTenant(req, res, next) {
  const user = req.session?.user || req.user;

  if (!user) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  // Extraer tenantId del usuario
  // Asume que el usuario tiene un campo tenantId
  const tenantId = user.tenantId || user.tenant_id;

  if (!tenantId) {
    return res.status(403).json({
      error: 'Usuario sin tenant asignado'
    });
  }

  // Establecer req.tenantId para uso en las rutas
  req.tenantId = tenantId;

  next();
const Tenant = require('../models/Tenant');
const logger = require('../backend/utils/logger');

/**
 * Middleware para identificar el tenant basándose en el subdomain
 * Extrae el subdomain del hostname y busca el tenant correspondiente en la BD
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function identifyTenant(req, res, next) {
  try {
    // Obtener el hostname completo de la request
    const host = req.get('host') || '';
    logger.debug('[Tenant] Procesando request', { host, url: req.url });

    // Extraer subdomain del hostname
    let subdomain = null;

    // Manejar localhost y desarrollo (ej: 'main.localhost:3000', 'test.localhost')
    if (host.includes('localhost')) {
      const parts = host.split('.');
      if (parts.length >= 2) {
        // Formato: 'subdomain.localhost' o 'subdomain.localhost:port'
        subdomain = parts[0].split(':')[0]; // Remover puerto si existe
        logger.debug('[Tenant] Subdomain extraído (localhost)', { subdomain });
      } else {
        // Solo 'localhost' sin subdomain
        logger.warn('[Tenant] Request a localhost sin subdomain', { host });
        return res.status(404).json({
          error: 'Tenant no encontrado',
          message: 'Se requiere un subdomain válido'
        });
      }
    } else {
      // Producción: Extraer subdomain de dominio real (ej: 'main.example.com')
      const parts = host.split('.');
      if (parts.length >= 3) {
        // Formato: 'subdomain.domain.com' o 'subdomain.domain.com:port'
        subdomain = parts[0].split(':')[0]; // Remover puerto si existe
        logger.debug('[Tenant] Subdomain extraído (producción)', { subdomain });
      } else {
        // Sin subdomain (ej: 'example.com')
        logger.warn('[Tenant] Request sin subdomain', { host });
        return res.status(404).json({
          error: 'Tenant no encontrado',
          message: 'Se requiere un subdomain válido'
        });
      }
    }

    // Validar que el subdomain no esté vacío
    if (!subdomain || subdomain.trim() === '') {
      logger.warn('[Tenant] Subdomain vacío después de extracción', { host });
      return res.status(404).json({
        error: 'Tenant no encontrado',
        message: 'Subdomain inválido'
      });
    }

    // Normalizar subdomain (lowercase, trim)
    subdomain = subdomain.toLowerCase().trim();

    // Buscar tenant en MongoDB por subdomain
    logger.debug('[Tenant] Buscando tenant en BD', { subdomain });
    const tenant = await Tenant.findOne({ subdomain }).lean();

    // Verificar si el tenant existe
    if (!tenant) {
      logger.warn('[Tenant] Tenant no encontrado en BD', { subdomain });
      return res.status(404).json({
        error: 'Tenant no encontrado',
        message: `No existe un tenant con subdomain '${subdomain}'`
      });
    }

    // Verificar si el tenant está activo
    if (!tenant.isActive) {
      logger.warn('[Tenant] Tenant inactivo', {
        subdomain,
        tenantId: tenant._id
      });
      return res.status(404).json({
        error: 'Tenant no encontrado',
        message: 'El tenant está inactivo'
      });
    }

    // Tenant válido y activo - agregar a la request
    req.tenant = tenant;           // Objeto completo del tenant
    req.tenantId = tenant._id;     // Solo el _id para queries

    logger.info('[Tenant] Tenant identificado correctamente', {
      subdomain,
      tenantId: tenant._id,
      tenantNombre: tenant.nombre
    });

    // Continuar con el siguiente middleware
    next();

  } catch (error) {
    // Manejo de errores
    logger.error('[Tenant] Error al identificar tenant', {
      error: error.message,
      stack: error.stack,
      host: req.get('host')
    });

    return res.status(500).json({
      error: 'Error interno del servidor',
      message: 'No se pudo procesar la solicitud'
    });
  }
}

module.exports = identifyTenant;
