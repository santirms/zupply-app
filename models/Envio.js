// models/Envio.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const tenantPlugin = require('../plugins/tenantPlugin');

const HistLocationSchema = new Schema({
  descripcion: { type: String, default: null },
  lat:         { type: Number, default: null },
  lng:         { type: Number, default: null }
}, { _id: false });

const HistItemSchema = new mongoose.Schema({
  at:        { type: Date, default: Date.now },
  estado:    { type: String },
  estado_meli: {
    status:    { type: String, default: null },
    substatus: { type: String, default: null }
  },
  source:     { type: String, default: 'panel' },
  actor_name: { type: String, default: null },
  note:       { type: String, default: '' },
  descripcion:      { type: String, default: null },
  substatus_texto:  { type: String, default: null },
  notas:            { type: String, default: null },
  ubicacion:        { type: HistLocationSchema, default: undefined },
  metadata:         { type: Schema.Types.Mixed, default: null },
  meli_event_id:    { type: String, default: null }
}, { _id: false });

const HistorialEstadoSchema = new Schema({
  estado: {
    type: String,
    required: true
  },
  fecha: {
    type: Date,
    required: true
  },
  usuario: { type: String, default: null },
  notas: { type: String, default: null },
  substatus: { type: String, default: null },
  substatus_display: { type: String, default: null },
  ml_status: { type: String, default: null },
  ml_substatus: { type: String, default: null },
  es_barrido_generico: { type: Boolean, default: false }
}, { _id: false });

const envioSchema = new Schema({
  sender_id:      { type: String, required: true },
  cliente_id:     { type: Schema.Types.ObjectId, ref: 'Cliente', required: false },
  id_venta:       { type: String, required: true },
  meli_id:        { type: String },
  codigo_postal:  { type: String, required: true },
  partido:        { type: String },
  
  qr_meta: {
    last_scan_at: { type: Date, default: null },
    valid_until:  { type: Date, default: null },
    last_hash:    { type: String, default: null }
  },
  zona_precio:    { type: String },
  zona:           { type: String },
  fecha:          { type: Date, default: Date.now },
  destinatario:   { type: String, required: true },
  telefono: {
    type: String,
    required: false,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true;
        return /^549\d{9,10}$/.test(v);
      },
      message: 'Teléfono debe tener formato 549XXXXXXXXXX'
    }
  },
  direccion:      { type: String, required: true },
  piso_dpto: {
    type: String,
    default: null,
    trim: true
  },
  referencia:     { type: String },
  precio:         { type: Number, default: 0 },
  chofer:         { type: Schema.Types.ObjectId, ref: 'Chofer', default: null },
  zonaAsignada:   { type: Schema.Types.ObjectId, ref: 'Zona',   default: null },
  estado: {
    type: String,
    enum: [
      'pendiente','asignado','en_planta','en_camino','demorado',
      'reprogramado','no_entregado','comprador_ausente','inaccesible','direccion_erronea',
      'entregado','rechazado','cancelado','llega_pronto','devolucion'
    ],
    default: 'pendiente'
  },
  substatus:       { type: String, default: null },
  substatus_display: { type: String, default: null },
  estado_meli: {
    status:    { type: String, default: null },
    substatus: { type: String, default: null },
    updatedAt: { type: Date,   default: null }
  },
  ml_status:    { type: String, default: null },
  ml_substatus: { type: String, default: null },
  latitud:        { type: Number, default: null },
  longitud:       { type: Number, default: null },
  label_url:  { type: String },
  qr_png:     { type: String },
  meli_history_last_sync: { type: Date, default: null },
  historial_estados: { type: [HistorialEstadoSchema], default: [] },
  requiere_sync_meli: {
    type: Boolean,
    default: true
  },
  comprador_ausente_confirmado: {
    type: Boolean,
    default: false,
    index: true
  },
  origen: {
    type: String,
    enum: ['mercadolibre', 'ingreso_manual', 'etiquetas', 'otro'],
    default: 'mercadolibre'
  },
  tipo: {
    type: String,
    enum: ['envio', 'retiro', 'cambio'],
    default: 'envio'
  },
  contenido: {
    type: String,
    maxlength: 500,
    default: null
  },
  cobroEnDestino: {
    habilitado: {
      type: Boolean,
      default: false
    },
    monto: {
      type: Number,
      min: 0,
      default: 0
    },
    cobrado: {
      type: Boolean,
      default: false
    },
    fechaCobro: {
      type: Date,
      default: null
    },
    metodoPago: {
      type: String,
      enum: ['efectivo', 'transferencia', null],
      default: null
    }
  },
  cobra_en_destino: {
    type: Boolean,
    default: false
  },
  monto_a_cobrar: {
    type: Number,
    min: 0,
    default: null
  },
  confirmacionEntrega: {
    confirmada: { type: Boolean, default: false },
    tipoReceptor: {
      type: String,
      enum: ['destinatario', 'porteria', 'familiar', 'otro'],
      default: 'destinatario'
    },
    nombreReceptor: String,
    dniReceptor: String,
    aclaracionReceptor: String,
    nombreDestinatario: String,
    dniDestinatario: String,
    firmaS3Url: String,
    firmaS3Key: String,
    fotoDNIS3Key: String,
    fechaEntrega: Date,
    horaEntrega: String,
    geolocalizacion: {
      lat: Number,
      lng: Number
    }
  },
  requiereFirma: {
    type: Boolean,
    default: false
  },
  dimensiones: {
    alto:    { type: Number, default: null },
    ancho:   { type: Number, default: null },
    largo:   { type: Number, default: null },
    peso:    { type: Number, default: null },
    volumen: { type: Number, default: null },
    items_count: { type: Number, default: null },
    source:  { type: String, default: 'meli' }
  },

  intentosFallidos: [{
    fecha: { type: Date, default: Date.now },
    motivo: {
      type: String,
      enum: [
        'ausente',
        'inaccesible',
        'direccion_incorrecta',
        'negativa_recibir',
        'otro'
      ]
    },
    descripcion: String,
    fotoS3Url: String,
    fotoS3Key: String,
    chofer: { type: Schema.Types.ObjectId, ref: 'Usuario' },
    geolocalizacion: {
      lat: Number,
      lng: Number
    }
  }]
}, { timestamps: false });

const NotaSchema = new Schema({
  texto: {
    type: String,
    required: true,
    trim: true
  },
  usuario: {
    type: String,
    default: null
  },
  fecha: {
    type: Date,
    default: Date.now
  },
  tipo: {
    type: String,
    enum: ['admin', 'chofer', 'sistema'],
    default: 'admin'
  },
  at: {
    type: Date,
    default() {
      return this.fecha || Date.now();
    }
  },
  actor_name: { type: String, default: null },
  actor_role: { type: String, default: null }
}, { _id: true });

NotaSchema.pre('validate', function syncLegacyFields(next) {
  if (!this.fecha && this.at) {
    this.fecha = this.at;
  } else if (!this.at && this.fecha) {
    this.at = this.fecha;
  }

  if (!this.usuario && this.actor_name) {
    this.usuario = this.actor_name;
  } else if (!this.actor_name && this.usuario) {
    this.actor_name = this.usuario;
  }

  next();
});

envioSchema.add({
  historial: { type: [HistItemSchema], default: [] },
  notas: [NotaSchema]
});

envioSchema.index(
  { meli_id: 1 },
  { unique: true, partialFilterExpression: { meli_id: { $exists: true, $nin: [null, ''] } } }
);

envioSchema.index({ cliente_id: 1, fecha: -1 });
envioSchema.index({ sender_id: 1, createdAt: -1 });
envioSchema.index({ estado: 1, createdAt: -1 });
envioSchema.index({ 'destino.partido': 1, createdAt: -1 });
envioSchema.index({ 'destino.loc': '2dsphere' });

// Aplicar plugin multi-tenant
envioSchema.plugin(tenantPlugin);

// Índices con tenantId
envioSchema.index({ tenantId: 1, createdAt: -1 });
envioSchema.index({ tenantId: 1, estado: 1 });
envioSchema.index({ tenantId: 1, id_venta: 1 });
envioSchema.index({ tenantId: 1, sender_id: 1 });

module.exports = mongoose.model('Envio', envioSchema);
