// models/Envio.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const envioSchema = new Schema({
  sender_id:      { type: String, required: true },
  cliente_id:     { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  id_venta:       { type: String, required: true },

  // Sólo para envíos MeLi; no guardes "" ni null
  meli_id:        { type: String },

  codigo_postal:  { type: String, required: true },

  /**
   * 👀 Mostrar en Panel General:
   * Partido / Localidad detectado desde el CP (p.ej. "Alte. Brown", "CABA", "Lomas de Zamora")
   */
  partido:        { type: String },

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
  direccion:      { type: String, required: true },
  referencia:     { type: String },

  // Monto final calculado según lista de precios y `zona_precio`
  precio:         { type: Number, default: 0 },

  // campos de asignación/operación
  chofer:         { type: Schema.Types.ObjectId, ref: 'Chofer', default: null },
  zonaAsignada:   { type: Schema.Types.ObjectId, ref: 'Zona',   default: null },
  estado:         { type: String, enum: ['pendiente','asignado'], default: 'pendiente' },

  latitud:        { type: Number, default: null },
  longitud:       { type: Number, default: null },
}, { timestamps: false });

/**
 * Índice de idempotencia:
 * Único sólo cuando meli_id existe y no es vacío.
 */
envioSchema.index(
  { meli_id: 1 },
  { unique: true, partialFilterExpression: { meli_id: { $exists: true, $nin: [null, ''] } } }
);

// (opcional) índice para listar por cliente/fecha más rápido en panel/facturación
envioSchema.index({ cliente_id: 1, fecha: -1 });

module.exports = mongoose.models.Envio || mongoose.model('Envio', envioSchema);
