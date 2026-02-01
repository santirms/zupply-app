// Usar el mapeo completo y actualizado de meliHistory
const { mapearEstadoML } = require('../services/meliHistory');

function mapMeliToInterno(status, substatus) {
  // Usar el mapeo completo y correcto
  const result = mapearEstadoML(status, substatus);
  return result.estado;
}

// Estados finales/terminales (incluye returned)
const TERMINALES = new Set(['delivered', 'cancelled', 'returned']);

module.exports = { mapMeliToInterno, TERMINALES };
