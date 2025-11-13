// models/Envio.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const HistLocationSchema = new Schema({
  descripcion: { type: String, default: null },
  lat:         { type: Number, default: null },
  lng:         { type: Number, default: null }
}, { _id: false });

const HistItemSchema = new mongoose.Schema({
  at:        { type: Date, default: Date.now },
  estado:    { type: String }, // tu estado unificado
  estado_meli: {
    status:    { type: String, default: null },
    substatus: { type: String, default: null }
  },
  source:     { type: String, default: 'panel' }, // 'meli:webhook' | 'meli:cron' | 'meli:force-sync' | 'panel' | 'scan' | 'api'
  actor_name: { type: String, default: null },    // tu chofer/operador si corresponde
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

  // Sólo para envíos MeLi; no guardes "" ni null
  meli_id:        { type: String },

  codigo_postal:  { type: String, required: true },

  /**
   * 👀 Mostrar en Panel General:
   * Partido / Localidad detectado desde el CP (p.ej. "Alte. Brown", "CABA", "Lomas de Zamora")
   */
  partido:        { type: String },
  
  qr_meta: {
  last_scan_at: { type: Date, default: null },
  valid_until:  { type: Date, default: null },
  last_hash:    { type: String, default: null }
  },
  /**
   * 💰 Usar en Facturación:
   * Nombre de la zona de la lista de precios (p.ej. "Zona 1", "CABA", "Interior")
   */
  zona_precio:    { type: String },

  /**
   * (opcional / legacy) Si en alguna parte usabas `zona` para ambas cosas,
   * lo dejamos para compatibilidad, pero NO lo uses más para UI.
   */
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
  referencia:     { type: String },

  // Monto final calculado según lista de precios y `zona_precio`
  precio:         { type: Number, default: 0 },

  // campos de asignación/operación
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
  status:    { type: String, default: null },   // p.ej. shipped, delivered, not_delivered...
  substatus: { type: String, default: null },   // p.ej. delayed, returning_to_sender...
  updatedAt: { type: Date,   default: null }
  },
  ml_status:    { type: String, default: null },
  ml_substatus: { type: String, default: null },

  latitud:        { type: Number, default: null },
  longitud:       { type: Number, default: null },

  label_url:  { type: String }, // /labels/<id_venta>.pdf
  qr_png:     { type: String }, // DataURL para previsualizar QR
  meli_history_last_sync: { type: Date, default: null },     // <<< NUEVO

  historial_estados: { type: [HistorialEstadoSchema], default: [] },

  // Flag para identificar si el envío se sincroniza con MeLi
  requiere_sync_meli: {
    type: Boolean,
    default: true  // true = MeLi (sincroniza), false = manual/etiquetas (editable)
  },

  comprador_ausente_confirmado: {
    type: Boolean,
    default: false,
    index: true
  },

  // Origen del envío
  origen: {
    type: String,
    enum: ['mercadolibre', 'ingreso_manual', 'etiquetas', 'otro'],
    default: 'mercadolibre'
  },

  // Tipo de envío (envío/retiro/cambio)
  tipo: {
    type: String,
    enum: ['envio', 'retiro', 'cambio'],
    default: 'envio'
  },

  // Descripción del contenido
  contenido: {
    type: String,
    maxlength: 500,
    default: null
  },

  // Cobro en destino (estructura completa)
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

  // Campos legacy para compatibilidad (deprecated)
  cobra_en_destino: {
    type: Boolean,
    default: false
  },
  monto_a_cobrar: {
    type: Number,
    min: 0,
    default: null
  },

  // Confirmación de entrega con firma digital
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
    // Campos legacy (mantener compatibilidad)
    nombreDestinatario: String,
    dniDestinatario: String,
    firmaS3Url: String,
    firmaS3Key: String,
    fechaEntrega: Date,
    horaEntrega: String,
    geolocalizacion: {
      lat: Number,
      lng: Number
    }
  },

  // Flag para indicar si el envío requiere firma digital
  requiereFirma: {
    type: Boolean,
    default: false
  },

  // Intentos fallidos de entrega con evidencia fotográfica
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
}, { _id: true }); // importante: _id para poder borrar

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

/**
 * Índice de idempotencia:
 * Único sólo cuando meli_id existe y no es vacío.
 */
envioSchema.add({
  historial: { type: [HistItemSchema], default: [] },
  notas: [NotaSchema]
});

envioSchema.index(
  { meli_id: 1 },
  { unique: true, partialFilterExpression: { meli_id: { $exists: true, $nin: [null, ''] } } }
);

// (opcional) índice para listar por cliente/fecha más rápido en panel/facturación
envioSchema.index({ cliente_id: 1, fecha: -1 });

// models/Envio.js
envioSchema.index({ sender_id: 1, createdAt: -1 });
envioSchema.index({ estado: 1, createdAt: -1 });
envioSchema.index({ 'destino.partido': 1, createdAt: -1 });
// Para mapa (destino.loc = { type: 'Point', coordinates: [lng, lat] })
envioSchema.index({ 'destino.loc': '2dsphere' });


module.exports = mongoose.models.Envio || mongoose.model('Envio', envioSchema);
