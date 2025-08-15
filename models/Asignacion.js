const mongoose = require('mongoose');
const { Schema } = mongoose;

const asignacionSchema = new Schema({
  chofer: { type: Schema.Types.ObjectId, ref: 'Chofer', required: true },
  zona:   { type: String },
  lista_chofer_id: { type: Schema.Types.ObjectId, ref: 'ListaDePrecios' },

  envios: [{
    envio:        { type: Schema.Types.ObjectId, ref: 'Envio', required: true },
    id_venta:     String,
    meli_id:      String,
    cliente_id:   { type: Schema.Types.ObjectId, ref: 'Cliente' },
    destinatario: String,
    direccion:    String,
    codigo_postal:String,
    partido:      String,
    precio:       Number
  }],

  total_paquetes: { type: Number, default: 0 },
  remito_url:     { type: String },
  fecha:          { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.Asignacion || mongoose.model('Asignacion', asignacionSchema);
