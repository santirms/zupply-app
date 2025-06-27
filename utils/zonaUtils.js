// zonaUtils.js
const Zona = require('../models/Zona');

async function buscarZonaPorCP(cp) {
  const zonasPorLista = await Zona.find({ codigos_postales: cp });
  if (zonasPorLista.length > 0) return zonasPorLista[0];

  const zonasPorRango = await Zona.find({ 'rango.desde': { $lte: cp }, 'rango.hasta': { $gte: cp } });
  if (zonasPorRango.length > 0) return zonasPorRango[0];

  return null;
}

module.exports = { buscarZonaPorCP };