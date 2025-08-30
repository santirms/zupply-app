// middlewares/auth.js

// === PANTALLAS habilitadas para coordinador ===
const PAGE_ALLOW = [
  /^\/$/, // home (tu SPA puede montar acá)
  /^\/panel-general(\/|$|\.html)/,
  /^\/panel-choferes(\/|$|\.html)/,
  /^\/ingreso-manual(\/|$|\.html)/,
  /^\/leer-etiquetas(\/|$|\.html)/,
  /^\/escanear(\/|$|\.html)/,
];

// === ESTÁTICOS comunes (bundles, fuentes, imágenes, PDFs, etc.) ===
const STATIC_ALLOW = [
  /^\/(css|js|img|images|assets|static|build|dist|fonts|media)(\/|$)/,
  /^\/labels(\/|$)/,   // tu carpeta estática de labels
  /^\/remitos(\/|$)/,  // tu carpeta estática de remitos
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/service-worker\.js$/,
  // extensiones típicas servidas desde la raíz
  /^\/.*\.(css|js|map|png|jpe?g|svg|ico|webp|woff2?|ttf|eot|pdf|txt|csv|xlsx)$/,
];

// === APIs necesarias por esos módulos ===
const API_ALLOW = [
  /^\/api\/zonas(\/|$)/,
  /^\/api\/envios(\/|$)/,
  /^\/api\/asignaciones(\/|$)/,
  /^\/api\/choferes(\/|$)/,
  /^\/api\/partidos(\/|$)/,
  /^\/api\/listas-de-precios(\/|$)/,
  /^\/api\/clientes(\/|$)/,
  /^\/api\/detectar-zona(\/|$)/,
  /^\/api\/auth\/meli(\/|$)/,
];

// Rutas no-API relacionadas
const OTHER_ALLOW = [
  /^\/auth\/meli(\/|$)/,
];

const ALLOWED_FOR_COORDINATOR = [
  ...PAGE_ALLOW,
  ...STATIC_ALLOW,
  ...API_ALLOW,
  ...OTHER_ALLOW,
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

  const ok = ALLOWED_FOR_COORDINATOR.some(rx => rx.test(req.path));
  if (ok) return next();

  // DEBUG temporal para ver qué está bloqueando:
  console.warn('[COORD 403]', req.method, req.path);

  if (req.accepts('html')) return res.status(403).send('Acceso restringido para coordinador');
  return res.status(403).json({ error: 'Acceso restringido para coordinador', path: req.path });
}

module.exports = { requireAuth, restrictCoordinator };
