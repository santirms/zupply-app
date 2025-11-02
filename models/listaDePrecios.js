const mongoose = require('mongoose');

const listaDePreciosSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  zonas: [
    {
      zona: { type: mongoose.Schema.Types.ObjectId, ref: 'Zona', required: true },
      precio: { type: Number, required: true }
    }
  ],
  fechaCreacion: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ListaDePrecios ||
  mongoose.model('ListaDePrecios', listaDePreciosSchema);
