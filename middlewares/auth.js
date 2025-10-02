function requireAuth(req, res, next) {
  const u = req.session?.user;
  if (u?.authenticated && u?.role) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (!u?.authenticated) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: 'Sin permisos' });
    next();
  };
}

/** Bloquea métodos de escritura para un rol (p.ej. coordinador solo-lectura en panel general) */
function restrictMethodsForRoles(role, blocked = ['POST','PUT','PATCH','DELETE']) {
  return (req, res, next) => {
    const u = req.session?.user;
    if (u?.role === role && blocked.includes(req.method)) {
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
    const sids = Array.isArray(u.sender_ids) ? u.sender_ids.filter(Boolean) : [];
    // si no tiene sender_ids, no debe ver nada
    const scope = sids.length ? { $in: sids } : { $in: ['__none__'] };
    return { ...baseFilter, sender_id: scope };
  }
  return baseFilter;
}

module.exports = {
  requireAuth,
  requireRole,
  restrictMethodsForRoles,
  onlyOwnShipments,
  onlyManualOrEtiqueta
};
