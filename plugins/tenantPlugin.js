const mongoose = require('mongoose');

/**
 * Plugin de Mongoose para multi-tenancy
 * Agrega el campo tenantId y filtrado automático
 */
function tenantPlugin(schema, options = {}) {
  // Agregar campo tenantId solo si no existe
  if (!schema.path('tenantId')) {
    schema.add({
      tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'Tenant'
      }
    });
  }

  // Hook pre-save: validar tenantId
  schema.pre('save', function(next) {
    if (!this.tenantId) {
      const error = new Error('tenantId es requerido');
      error.name = 'ValidationError';
      return next(error);
    }
    next();
  });

  // Hooks de consulta: filtrar por tenantId si está en options
  const queryHooks = [
    'find',
    'findOne', 
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndRemove',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany'
  ];

  queryHooks.forEach(hook => {
    schema.pre(hook, function() {
      if (this.getQuery().tenantId === undefined && this.options.tenantId) {
        this.where({ tenantId: this.options.tenantId });
      }
    });
  });

  // Método estático para establecer tenantId en contexto
  schema.statics.forTenant = function(tenantId) {
    return this.setOptions({ tenantId });
  };
}

module.exports = tenantPlugin;
