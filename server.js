require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../zupply-app')));

const zonaRoutes = require('./routes/zonas');
app.use('/zonas', zonaRoutes);

const tarifaRoutes = require('./routes/tarifas');
app.use('/tarifas', tarifaRoutes);

const clienteRoutes = require('./routes/clientes');
app.use('/clientes', clienteRoutes);

const zonaPorCpRoutes = require('./routes/zonaPorCp');
app.use('/zona-por-cp', zonaPorCpRoutes);

const escaneoRoutes = require('./routes/escanear');
app.use('/escanear', escaneoRoutes);

const enviosRoutes = require('./routes/envios');
app.use('/envios', enviosRoutes);

// Ruta por defecto para cualquier archivo HTML
// app.get('/', (req, res) => {
//  res.sendFile(path.join(__dirname, '../zupply-app/index.html'));
//});

const PORT = process.env.PORT || 4000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Conectado a MongoDB');
    app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
  })
  .catch(err => console.error('Error de conexión:', err));
