// models/Etiqueta.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantPlugin = require('../plugins/tenantPlugin');

const etiquetaSchema = new Schema({
  numero: {
    type: String,
    required: false
  },
  meli_id: {
    type: String,
    default: null
  },
  sender_id: {
    type: String,
    required: true
  },
  cliente_id: {
    type: Schema.Types.ObjectId,
    ref: 'Cliente',
    required: false
  },
  tracking_id: {
    type: String,
    default: null
  },
  id_venta: {
    type: String,
    default: null
  },
  codigo_postal: {
    type: String,
    required: true
  },
  partido: {
    type: String,
    default: null
  },
  zona: {
    type: String,
    default: null
  },
  destinatario: {
    type: String,
    required: true
  },
  telefono: {
    type: String,
    default: null
  },
  direccion: {
    type: String,
    required: true
  },
  piso_dpto: {
    type: String,
    default: null,
    trim: true
  },
  referencia: {
    type: String,
    default: null
  },
  fecha: {
    type: Date,
    default: Date.now
  },
  precio: {
    type: Number,
    default: 0
  },
  estado: {
    type: String,
    enum: [
      'pendiente', 'asignado', 'en_planta', 'en_camino', 'demorado',
      'reprogramado', 'no_entregado', 'comprador_ausente', 'inaccesible',
      'direccion_erronea', 'entregado', 'rechazado', 'cancelado',
      'llega_pronto', 'devolucion'
    ],
    default: 'en_planta'
  },
  requiere_sync_meli: {
    type: Boolean,
    default: false
  },
  origen: {
    type: String,
    enum: ['mercadolibre', 'ingreso_manual', 'etiquetas', 'otro'],
    default: 'etiquetas'
  },
  source: {
    type: String,
    default: 'pdf'
  },
  latitud: {
    type: Number,
    default: null
  },
  longitud: {
    type: Number,
    default: null
  },
  destino: {
    partido: { type: String, default: null },
    cp: { type: String, default: null },
    loc: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        default: undefined
      }
    }
  }
}, { timestamps: true });

// Aplicar el plugin de multi-tenancy
etiquetaSchema.plugin(tenantPlugin);

// Índice compuesto: tenantId + createdAt
etiquetaSchema.index({ tenantId: 1, createdAt: -1 });

// Índice compuesto: tenantId + numero (si existe el campo)
etiquetaSchema.index({ tenantId: 1, numero: 1 });

// Índice para búsquedas por tracking_id
etiquetaSchema.index({ tracking_id: 1 });

// Índice para búsquedas por estado
etiquetaSchema.index({ estado: 1 });

// Índice 2dsphere para consultas geoespaciales
etiquetaSchema.index({ 'destino.loc': '2dsphere' });

module.exports = mongoose.models.Etiqueta || mongoose.model('Etiqueta', etiquetaSchema);
