//require('dotenv').config(); // Usar solo en local si querés

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rutas API
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/listas-de-precios', require('./routes/listasDePrecios'));
app.use('/api/zonas', require('./routes/zonas'));
app.use('/api/partidos', require('./routes/partidos'));
app.use('/api/envios', require('./routes/envios'));
app.use('/api/detectar-zona', require('./routes/detectarZona'));
app.use('/api/zona-por-cp', require('./routes/zonaPorCp'));
app.use('/api/escanear', require('./routes/escanear'));
app.use('/api/leer-etiquetas', require('./routes/leerEtiquetas'));
app.use('/api/auth/meli', require('./routes/meli'));

// Conexión a Mongo y arranque
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB');
    app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));
