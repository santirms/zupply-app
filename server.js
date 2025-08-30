require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

/* ===================== Básicos ===================== */
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

/* ===================== Sesión ====================== */
app.use(session({
  name: 'zupply.sid',
  secret: process.env.SESSION_SECRET || 'cambialo-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

/* ===================== Auth públicas =============== */
app.use('/auth', require('./routes/auth'));

/* ============ Guardia global (login requerido) ===== */
app.use((req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  if (req.session?.user) return next();
  if (req.accepts('html')) return res.redirect('/auth/login');
  return res.status(401).json({ error: 'Login requerido' });
});

/* ===================== Rol coordinador ============= */
try {
  const { restrictCoordinator } = require('./middlewares/auth');
  app.use(restrictCoordinator); // en tu middleware restringimos SOLO /api
} catch {}

/* ============ Static del FRONT (SPA) =============== */
/** Elegimos automáticamente dónde está el index.html del front */
const FRONT_CANDIDATES = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '../zupply-app'),
  path.join(__dirname, '../zupply-app/dist'),
  path.join(__dirname, '../zupply-app/build'),
];
const FRONT_ROOT = FRONT_CANDIDATES.find(p => fs.existsSync(path.join(p, 'index.html')));

if (FRONT_ROOT) {
  console.log('[FRONT] Sirviendo estáticos desde:', FRONT_ROOT);
  app.use(express.static(FRONT_ROOT));
} else {
  console.warn('[FRONT] index.html NO encontrado. Revisa la ubicación del build.');
}

/* Carpetas estáticas internas (PDFs, etc.) */
app.use('/labels',  express.static(path.join(__dirname, 'public', 'labels')));
app.use('/remitos', express.static(path.join(__dirname, 'public', 'remitos')));

/* ============ APIs (prefijo /api) ================== */
app.use('/api/zonas',             require('./routes/zonas'));
app.use('/api/listas-de-precios', require('./routes/listasDePrecios'));
app.use('/api/partidos',          require('./routes/partidos'));
app.use('/api/envios',            require('./routes/envios'));
app.use('/api/asignaciones',      require('./routes/asignaciones')); // salida
app.use('/api/choferes',          require('./routes/choferes'));
app.use('/api/clientes',          require('./routes/clientes'));
app.use('/api/detectar-zona',     require('./routes/detectarZona'));
app.use('/api/auth/meli',         require('./routes/meli'));

/* ======= SPA catch: servir index.html en pantallas == */
/** IMPORTANTe: esto debe ir DESPUÉS de estáticos y ANTES de montar rutas no-API que
    colisionen con paths del front. Así /ingreso-manual, /escanear, etc. cargan la SPA. */
if (FRONT_ROOT) {
  const serveFront = (_req, res) => res.sendFile(path.join(FRONT_ROOT, 'index.html'));
  app.get([
    '/',                // home
    '/panel-general',
    '/escanear',
    '/leer-etiquetas',
    '/ingreso-manual',
    '/panel-choferes',
  ], serveFront);
}

/* ====== (Opcional) Rutas NO-API legacy: mejor evitar ======
   Si tenías rutas tipo '/escanear' en el servidor, pueden chocar con la SPA.
   Recomiendo mover su lógica a '/api/...'. Si igual las necesitás, montalas AQUÍ
   y usa métodos POST/PUT/DELETE (GET a esas rutas lo toma la SPA arriba). */

// const zonaRoutes = require('./routes/zonas');          app.use('/zonas', zonaRoutes);
// const clienteRoutes = require('./routes/clientes');    app.use('/clientes', clienteRoutes);
// const zonaPorCpRoutes = require('./routes/zonaPorCp'); app.use('/zona-por-cp', zonaPorCpRoutes);
// const escaneoRoutes = require('./routes/escanear');    app.use('/escanear', escaneoRoutes);
// const enviosRoutes = require('./routes/envios');       app.use('/envios', enviosRoutes);
// const leerEtiquetas = require('./routes/leerEtiquetas'); app.use('/leer-etiquetas', leerEtiquetas);
// const listaDP = require('./routes/listasDePrecios');   app.use('/listas-de-precios', listaDP);
// const partidosRoutes = require('./routes/partidos');   app.use('/partidos', partidosRoutes);
// const meliRoutes = require('./routes/meli');           app.use('/auth/meli', meliRoutes);

/* ===================== DB & Server ================== */
const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB');
    app.listen(PORT, () => console.log(Servidor corriendo en puerto ${PORT}));
  })
  .catch(err => console.error('Error de conexión:', err));

/* =========== Limpieza de remitos cada 24h =========== */
function cleanupOldRemitos() {
  const dir = path.join(__dirname, 'public', 'remitos');
  const keepMs = 15 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  fs.mkdirSync(dir, { recursive: true });
  fs.readdir(dir, (e, files) => {
    if (e) return;
    files.forEach(f => {
      const p = path.join(dir, f);
      fs.stat(p, (err, st) => {
        if (!err && (now - st.mtimeMs) > keepMs) fs.unlink(p, () => {});
      });
    });
  });
}
cleanupOldRemitos();
setInterval(cleanupOldRemitos, 24 * 60 * 60 * 1000);
