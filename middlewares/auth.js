// middlewares/auth.js
// === Rutas permitidas para COORDINADOR ===
// (ajustá si tus paths reales difieren)
const ALLOWED_FOR_COORDINATOR = [
  // Páginas
  /^\/$/,                               // root: lo redirigimos abajo a /panel-general
  /^\/panel-general(\/|$)/,
  /^\/panel-choferes(\/|$)/,
  /^\/ingreso-manual(\/|$)/,
  /^\/leer-etiquetas(\/|$)/,            // subir etiquetas
  /^\/escanear(\/|$)/,                  // escanear paquetes

  // Assets estáticos (bundles del front)
  /^\/(css|js|img|assets|static|build|dist|fonts|media)(\/|$)/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/service-worker\.js$/,

  // APIs necesarias para esos paneles
  /^\/api\/zonas(\/|$)/,
  /^\/api\/envios(\/|$)/,
  /^\/api\/asignaciones(\/|$)/,
  /^\/api\/choferes(\/|$)/,
  /^\/api\/partidos(\/|$)/,
  /^\/api\/listas-de-precios(\/|$)/,
  /^\/api\/clientes(\/|$)/,
  /^\/api\/detectar-zona(\/|$)/,
  /^\/api\/auth\/meli(\/|$)/,          // si no lo usa, quitalo
];

function requireAuth(req, res, next) {
  if (req.path.startsWith('/auth')) return next();
  if (req.session && req.session.user) return next();
  if (req.accepts('html')) return res.redirect('/auth/login');
  return res.status(401).json({ error: 'Login requerido' });
}

function restrictCoordinator(req, res, next) {
  const u = req.session?.user;
  if (!u || u.role !== 'coordinator') return next(); // admin u otros → pasan
  if (req.path === '/') return res.redirect('/panel-general'); // comodidad

  const ok = ALLOWED_FOR_COORDINATOR.some(rx => rx.test(req.path));
  if (ok) return next();

  return res.status(403).send('Acceso restringido para coordinador');
}

module.exports = { requireAuth, restrictCoordinator };
