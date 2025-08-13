require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

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

function printRoutes(app) {
  const routes = [];
  app._router.stack.forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach(r => {
        const route = r.route;
        if (route) {
          const methods = Object.keys(route.methods).join(',').toUpperCase();
          routes.push(`${methods} ${layer.regexp} -> ${route.path}`);
        }
      });
    }
  });
  console.log('Rutas registradas:\n' + routes.join('\n'));
}
printRoutes(app);
