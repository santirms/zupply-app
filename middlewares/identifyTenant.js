// middlewares/identifyTenant.js
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
}

module.exports = identifyTenant;
