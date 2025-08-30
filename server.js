require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const mongoose = require('mongoose');
const fs   = require('fs');

const app = express();

app.set('trust proxy', 1);
// === Sesión ===
app.use(session({
  name: 'zupply.sid',
  secret: process.env.SESSION_SECRET || 'cambialo-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', sameSite: 'lax', maxAge: 1000*60*60*8 }
}));

// Rutas de auth
// Rutas de auth (públicas)
app.use('/auth', require('./routes/auth'));

// === GUARDIA GLOBAL ANTI-INVITADOS ===
// Bloquea TODO lo que no sea /auth si no hay sesión
app.use((req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  if (req.session?.user) return next();

  if (req.accepts('html')) return res.redirect('/auth/login');
  return res.status(401).json({ error: 'Login requerido' });
});

// (opcional) Restricción de rol coordinador
try {
  const { restrictCoordinator } = require('./middlewares/auth');
  app.use(restrictCoordinator);
} catch {}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../zupply-app')));
app.use(express.urlencoded({ extended: true }));

// Zonas
app.use('/api/zonas', require('./routes/zonas'));

// Listas de precios (asegurate de usar el mismo path que en tu front)
app.use('/api/listas-de-precios', require('./routes/listasDePrecios'));
app.use('/api/partidos', require('./routes/partidos'));
app.use('/api/partidos',   require('./routes/partidos'));
app.use('/api/envios',     require('./routes/envios'));
app.use('/api/asignaciones',  require('./routes/asignaciones')); // salida
app.use('/api/choferes',       require('./routes/choferes'));

// Clientes
app.use('/api/clientes',      require('./routes/clientes'));

//Ruta por defecto para cualquier archivo HTML
app.use(express.static(path.join(__dirname, 'public')));
app.use('/labels', express.static(path.join(__dirname, 'public', 'labels')));
app.use('/remitos', express.static(path.join(__dirname, 'public', 'remitos')));

// 2) Monta tus APIs con prefijo /api
app.use('/api/clientes',       require('./routes/clientes'));
app.use('/api/listas-de-precios', require('./routes/listasDePrecios'));

const zonaRoutes = require('./routes/zonas');
app.use('/zonas', zonaRoutes);

const detectarZona = require('./routes/detectarZona');
app.use('/api/detectar-zona', detectarZona);

const clienteRoutes = require('./routes/clientes');
app.use('/clientes', clienteRoutes);

const zonaPorCpRoutes = require('./routes/zonaPorCp');
app.use('/zona-por-cp', zonaPorCpRoutes);

const escaneoRoutes = require('./routes/escanear');
app.use('/escanear', escaneoRoutes);

const enviosRoutes = require('./routes/envios');
app.use('/envios', enviosRoutes);

const meliRoutes = require('./routes/meli');
app.use('/api/auth/meli', meliRoutes);
app.use('/auth/meli', meliRoutes);

const leerEtiquetas = require('./routes/leerEtiquetas');
app.use('/leer-etiquetas', leerEtiquetas);

const listaDePreciosRoutes = require('./routes/listasDePrecios');
app.use('/listas-de-precios', listaDePreciosRoutes);

const partidosRoutes = require('./routes/partidos');
app.use('/partidos', partidosRoutes);

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB');
    app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
  })
  .catch(err => console.error('Error de conexión:', err));

// limpieza cada 24h (archivos > 15 días)
function cleanupOldRemitos() {
  const dir = path.join(__dirname, 'public', 'remitos');
  const keepMs = 15*24*60*60*1000;
  const now = Date.now();
  fs.mkdirSync(dir,{recursive:true});
  fs.readdir(dir,(e,files)=>{ if(e) return;
    files.forEach(f=>{
      const p = path.join(dir,f);
      fs.stat(p,(err,st)=>{ if(!err && (now - st.mtimeMs) > keepMs) fs.unlink(p,()=>{}); });
    });
  });
}
cleanupOldRemitos();
setInterval(cleanupOldRemitos, 24*60*60*1000);
