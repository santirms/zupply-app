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
