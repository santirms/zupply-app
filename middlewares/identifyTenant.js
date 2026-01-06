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
}

module.exports = identifyTenant;
