// middlewares/identifyTenant.js
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
