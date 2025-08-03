const Zona = require('../models/Zona');
// test.js
(async () => {
  const resultado = await detectarZona('1100');
  })();

async function detectarZona(cp) {
  cp = cp.toString(); // Asegura que es string

  try {
    // 1. Buscar zonas con array de códigos postales
    const zonaArray = await Zona.findOne({ codigos_postales: cp });
    if (zonaArray) return { zona: zonaArray.nombre };

    // 2. Buscar zonas por rango
    const cpNum = parseInt(cp);
    const zonaRango = await Zona.findOne({
      'rango.desde': { $lte: cpNum },
      'rango.hasta': { $gte: cpNum }
    });

    if (zonaRango) return { zona: zonaRango.nombre };

    // 3. Si no encontró nada
    return null;
  } catch (error) {
    console.error('Error detectando zona:', error);
    return null;
  }
}

module.exports = detectarZona;
