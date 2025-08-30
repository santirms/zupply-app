const ALLOWED_FOR_COORDINATOR = [
  /^\/panel-choferes(\/|$)/,
  /^\/ingreso-manual(\/|$)/,
  /^\/etiquetas\/subir(\/|$)/,
  /^\/escanear-paquetes(\/|$)/,
  /^\/panel-general(\/|$)/,

  // estáticos necesarios (ajustá si usás carpetas distintas)
  /^\/(css|js|img|assets|uploads)(\/|$)/,
  /^\/favicon\.ico$/,
];

function requireAuth(req, res, next) {
  if (req.path.startsWith('/auth')) return next(); // login/logout/me
  if (req.session && req.session.user) return next();
  // No logueado → al login
  return res.redirect('/auth/login');
}

function restrictCoordinator(req, res, next) {
  const u = req.session?.user;
  if (!u || u.role !== 'coordinator') return next(); // admin u otros → siguen
  const ok = ALLOWED_FOR_COORDINATOR.some(rx => rx.test(req.path));
  if (ok) return next();
  return res.status(403).send('Acceso restringido para coordinador');
}

module.exports = { requireAuth, restrictCoordinator };
