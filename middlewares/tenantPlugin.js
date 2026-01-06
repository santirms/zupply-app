const mongoose = require('mongoose');

/**
 * Plugin para agregar soporte multi-tenant a esquemas de Mongoose
 * Agrega el campo tenantId y middleware para filtrado automático
 */
function tenantPlugin(schema, options) {
  // Agregar campo tenantId al schema
  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true
    }
  });

  // Middleware para asegurar que siempre se filtre por tenantId en queries
  // (opcional, se puede activar con options.autoFilter: true)
  if (options && options.autoFilter) {
    schema.pre('find', function() {
      if (this.getQuery().tenantId === undefined) {
        // Solo aplicar si hay un tenantId en el contexto
        if (this.options.tenantId) {
          this.where({ tenantId: this.options.tenantId });
        }
      }
    });

    schema.pre('findOne', function() {
      if (this.getQuery().tenantId === undefined) {
        if (this.options.tenantId) {
          this.where({ tenantId: this.options.tenantId });
        }
      }
    });
  }
}

module.exports = tenantPlugin;
