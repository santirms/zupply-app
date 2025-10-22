function requireAuth(req, res, next) {
  const user = req.session?.user;
  if (user?.authenticated && user?.role) {
    req.user = user;
    return next();
  }
  return res.status(401).json({ error: 'No autenticado' });
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.session?.user;

    if (!user?.authenticated) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const userRole = user.role || user.tipo || null;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'No tienes permisos para esta acción',
        required: allowedRoles,
        current: userRole
      });
    }

    req.user = user;
    next();
  };
}

/** Bloquea métodos de escritura para un rol (p.ej. coordinador solo-lectura en panel general) */
function restrictMethodsForRoles(role, blocked = ['POST','PUT','PATCH','DELETE'], options = {}) {
  const exceptions = Array.isArray(options.exceptions) ? options.exceptions : [];

  const matchesException = (req) => {
    return exceptions.some((ex) => {
      if (!ex) return false;

      if (typeof ex === 'function') {
        return ex(req) === true;
      }

      const methods = ex.methods || ex.method;
      if (methods) {
        const list = Array.isArray(methods) ? methods : [methods];
        if (!list.includes(req.method)) return false;
      }

      const { path } = ex;
      if (!path) return false;
      if (Array.isArray(path)) {
        return path.includes(req.path);
      }
      if (typeof path === 'string') {
        return req.path === path;
      }
      if (path instanceof RegExp) {
        return path.test(req.path);
      }
      if (typeof path === 'function') {
        return path(req) === true;
      }
      return false;
    });
  };

  return (req, res, next) => {
    const u = req.session?.user;
    if (u?.role === role && blocked.includes(req.method) && !matchesException(req)) {
      return res.status(403).json({ error: 'Solo lectura para tu rol' });
    }
    next();
  };
}

/** Verifica que el envío sea del chofer logueado (asume campo chofer_id en Envio) */
async function onlyOwnShipments(req, res, next) {
  try {
    const u = req.session?.user;
    if (u?.role !== 'chofer') return res.status(403).json({ error: 'Solo chofer' });

    const Envio = require('../models/Envio');
    const envioId = req.params.id || req.body.envio_id;
    const envio = await Envio.findById(envioId).select('chofer_id source');
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    if (String(envio.chofer_id) !== String(u.driver_id)) {
      return res.status(403).json({ error: 'No es tu envío' });
    }
    req.envio = envio;
    next();
  } catch (e) { next(e); }
}

/** Limita que el chofer solo marque entregado si es manual/etiqueta (no Flex) */
function onlyManualOrEtiqueta(req, res, next) {
  const envio = req.envio;
  const permitidas = ['panel','scan','pdf','etiqueta']; // ajustá a tus sources reales
  if (!envio || !permitidas.includes(envio.source)) {
    return res.status(403).json({ error: 'No se puede modificar este envío' });
  }
  next();
}

// Filtra automáticamente por sender_ids si el usuario es rol 'cliente'
function applyClientScope(req, baseFilter = {}) {
  const u = req.session?.user;
  if (u?.role === 'cliente') {
    const sids = (Array.isArray(u.sender_ids) ? u.sender_ids : []).map(String);
    // si no tiene sender_ids, no debe ver nada
    const scope = sids.length ? { $in: sids } : { $in: ['__none__'] };
    filter = { ...baseFilter, sender_id: { $in: sids.length ? sids : ['__none__'] } };
  }
  return baseFilter;
}

module.exports = {
  requireAuth,
  requireRole,
  restrictMethodsForRoles,
  onlyOwnShipments,
  onlyManualOrEtiqueta,
  applyClientScope
};
