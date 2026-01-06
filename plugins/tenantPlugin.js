// plugins/tenantPlugin.js
const mongoose = require('mongoose');

/**
 * Plugin para multi-tenancy
 * Agrega el campo tenantId a todos los schemas y asegura
 * que las consultas estén limitadas al tenant correcto
 */
module.exports = function tenantPlugin(schema, options) {
  // Agregar campo tenantId al schema
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cliente',
      required: true,
      index: true
    }
  });

  // Agregar índice compuesto con createdAt si no existe
  // (se puede sobrescribir en el modelo individual)
  if (!options || !options.skipDefaultIndex) {
    schema.index({ tenantId: 1, createdAt: -1 });
  }
};
 * Plugin de Mongoose para multi-tenancy
 *
 * Agrega funcionalidad de multi-tenancy a cualquier schema de Mongoose:
 * - Campo tenantId (ObjectId, required, indexed)
 * - Filtrado automático por tenantId en consultas
 * - Validación de tenantId antes de guardar
 *
 * @param {mongoose.Schema} schema - El schema de Mongoose a modificar
 * @param {Object} options - Opciones del plugin (opcional)
 */
function tenantPlugin(schema, options = {}) {
  // 1. Agregar campo tenantId al schema
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: 'Tenant' // Opcional: referencia al modelo Tenant si existe
    }
  });

  // 2. Hook pre('save') - Validar que tenantId existe antes de guardar
  schema.pre('save', function(next) {
    if (!this.tenantId) {
      const error = new Error('tenantId es requerido');
      error.name = 'ValidationError';
      return next(error);
    }
    next();
  });

  // 3. Hook pre('find') - Filtrar automáticamente por tenantId
  schema.pre('find', function() {
    // Solo aplicar el filtro si no se ha especificado explícitamente tenantId
    // y si existe un tenantId en el contexto (por ejemplo, de un middleware)
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  // 4. Hook pre('findOne') - Filtrar automáticamente por tenantId
  schema.pre('findOne', function() {
    // Solo aplicar el filtro si no se ha especificado explícitamente tenantId
    // y si existe un tenantId en el contexto (por ejemplo, de un middleware)
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  // 5. Hooks adicionales para otras operaciones de consulta (opcional pero recomendado)
  schema.pre('findOneAndUpdate', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('findOneAndDelete', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('findOneAndRemove', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('updateOne', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('updateMany', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('deleteOne', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  schema.pre('deleteMany', function() {
    if (this.getQuery().tenantId === undefined && this.options.tenantId) {
      this.where({ tenantId: this.options.tenantId });
    }
  });

  // 6. Método estático para establecer el tenantId en el contexto de consulta
  schema.statics.forTenant = function(tenantId) {
    return this.setOptions({ tenantId });
  };
}

module.exports = tenantPlugin;
