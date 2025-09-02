require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');   // ← importa el store
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

/* ------------------------- Middlewares base ------------------------- */
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* --------------------------- Sesión segura -------------------------- */
app.use(session({
  name: 'zupply.sid',
  secret: process.env.SESSION_SECRET || 'cambialo-en-produccion',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,            // usa tu var actual
    ttl: 60 * 60 * 24 * 7                       // 7 días
  }),
  cookie: {
    secure: 'auto',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8                  // 8 h
  }
}));

/* --------------------------- Rutas públicas ------------------------- */
// Auth público (login/logout)
app.use('/auth', require('./routes/auth'));

// Archivos estáticos públicos mínimos (login y assets)
app.use(express.static(path.join(__dirname, 'public')));
// si tu login está en public/login.html podés servirlo corto:
app.get('/auth/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// panel protegido: muestra panel-general.html
app.get('/index', (req, res) => {
  if (!req.session?.user?.authenticated) {
    return res.redirect('/auth/login');
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const pages = {
  '/':                 'index.html',
  '/panel-general':    'index.html',
  '/panel/envios':     'panel-general.html',
  '/panel/ingreso':    'ingreso-manual.html',
  '/panel/escanear':   'scanner.html',
  '/panel/etiquetas':  'panel-etiquetas.html',
  '/panel/choferes':   'choferes.html',
  '/panel/facturacion':'facturacion-general.html'
};

for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => {
    if (!req.session?.user?.authenticated) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, 'public', file));
  });
}

/* -------- Guardia global: bloquea TODO lo no público si no hay sesión ------- */
app.use((req, res, next) => {
  // Permitir auth y archivos públicos
  if (req.path.startsWith('/auth')) return next();
  if (req.path.startsWith('/public')) return next();
  if (req.session?.user) return next();

  // HTML → redirige a login, API → 401 JSON
  if (req.accepts('html')) return res.redirect('/auth/login');
  return res.status(401).json({ error: 'Login requerido' });
});

/* -------------- A partir de acá, todo requiere sesión ---------------- */
app.use('/api/zonas',            require('./routes/zonas'));
app.use('/api/listas-de-precios',require('./routes/listasDePrecios'));
app.use('/api/partidos',         require('./routes/partidos'));
app.use('/api/clientes',         require('./routes/clientes'));
app.use('/users',                require('./routes/users')); // detrás del guardia global

// PANEL GENERAL DE ENVÍOS (coordinador solo lectura; ver routes/envios.js)
app.use('/api/envios',           require('./routes/envios'));

// Módulos permitidos a admin + coordinador (crear/ingresar/subir)
app.use('/api/ingreso',          require('./routes/ingreso'));     // /manual, /guardar-masivo
app.use('/api/etiquetas',        require('./routes/etiquetas'));   // /cargar-masivo
app.use('/api/choferes',         require('./routes/choferes'));    // asignación por qr/mapa

// Chofer: sus envíos del día + marcar entregado
app.use('/api/mis-envios',       require('./routes/mis-envios'));

// Otros módulos que ya tenías (si deben estar protegidos, dejalos después del guard)
app.use('/api/asignaciones',     require('./routes/asignaciones'));
app.use('/api/detectar-zona',    require('./routes/detectarZona'));
app.use('/api/auth/meli',        require('./routes/meli'));
app.use('/auth/meli',            require('./routes/meli'));

// Rutas “legacy” sin /api (si tu front las usa así, mantenelas)
app.use('/zonas',                require('./routes/zonas'));
app.use('/clientes',             require('./routes/clientes'));
app.use('/listas-de-precios',    require('./routes/listasDePrecios'));
app.use('/partidos',             require('./routes/partidos'));
app.use('/escanear',             require('./routes/escanear'));
app.use('/envios',               require('./routes/envios'));
app.use('/leer-etiquetas',       require('./routes/leerEtiquetas'));

/* -------------------- Estáticos privados (tras login) -------------------- */
// Tu build/SPA del panel (si lo usás)
app.use(express.static(path.join(__dirname, '../zupply-app')));
app.use('/labels',  express.static(path.join(__dirname, 'public', 'labels')));
app.use('/remitos', express.static(path.join(__dirname, 'public', 'remitos')));

/* -------------------- DB & server start -------------------- */
const PORT = process.env.PORT || 4000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB');
    app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
  })
  .catch(err => console.error('Error de conexión:', err));

/* ------- Limpieza de archivos viejos en /public/remitos cada 24h -------- */
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
