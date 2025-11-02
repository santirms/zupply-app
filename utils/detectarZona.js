// utils/detectarZona.js
const Partido = require('../models/partidos'); // { codigo_postal, partido }
const Zona    = require('../models/Zona');     // { nombre, partidos: [String] }

function ciEquals(a = '', b = '') {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

module.exports = async function detectarZona(cpInput) {
  const cp = String(cpInput || '').trim();
  let partido = '', zona = '';

  try {
    // 1) CP -> partido
    const partDoc = await Partido.findOne({ codigo_postal: cp });
    partido = partDoc?.partido || '';

    // 2) partido -> zona (comparación case-insensitive)
    if (partido) {
      const zonas = await Zona.find({ partidos: { $exists: true, $ne: [] } });
      const hit   = zonas.find(z =>
        Array.isArray(z.partidos) && z.partidos.some(p => ciEquals(p, partido))
      );
      zona = hit?.nombre || '';
    }

    if (process.env.DEBUG_DETECTAR_ZONA === '1') {
      console.log('[detectarZona] cp=%s => partido=%s, zona=%s', cp, partido, zona);
    }
  } catch (e) {
    console.error('[detectarZona] error:', e.message);
  }

  return { partido, zona };
};
