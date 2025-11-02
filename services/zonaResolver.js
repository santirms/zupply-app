// /services/zonaResolver.js
const Partido      = require('../models/partidos');
const Zona         = require('../models/Zona');
const ZonaPorCP    = require('../models/ZonaPorCP');

/**
 * Dado un CP y (opcional) partido, devuelve:
 * { partido, zonaId, zonaNombre, origen: 'cp'|'partido'|null }
 *
 * - Primero intenta por tabla de CPs (ZonaPorCP.codigos_postales)
 * - Si no hay, busca partido por CP (models/partidos)
 *   y luego matchea una Zona que contenga ese partido en su array `partidos`.
 * - Si encuentra por nombre (cuando viene de ZonaPorCP), hace lookup en `Zona` por nombre
 *   para devolver zonaId y compatibilizar con ListaDePrecios (que referencia Zona por _id).
 */
async function resolverZonaPorCP(cp, partidoHint = null) {
  const cpStr = String(cp || '').trim();
  if (!cpStr) return { partido: null, zonaId: null, zonaNombre: null, origen: null };

  // 1) Match por CP en ZonaPorCP
  const zcp = await ZonaPorCP.findOne({ codigos_postales: cpStr }).lean();
  if (zcp) {
    // Tenemos nombre, ahora buscamos la Zona "maestra" con ese nombre para obtener el _id
    const z = await Zona.findOne({ nombre: new RegExp(`^${zcp.nombre}$`, 'i') }).lean();
    return {
      partido: null, // lo resolvemos abajo si hace falta
      zonaId: z ? z._id : null,
      zonaNombre: zcp.nombre,
      origen: 'cp'
    };
  }

  // 2) Si no hubo por CP, buscamos partido
  let partido = partidoHint;
  if (!partido) {
    const pdoc = await Partido.findOne({ codigo_postal: cpStr }).lean();
    partido = pdoc?.partido || null;
  }
  if (!partido) {
    return { partido: null, zonaId: null, zonaNombre: null, origen: null };
  }

  // 3) Con el partido, buscamos una Zona que lo contenga
  const zona = await Zona.findOne({ partidos: new RegExp(`^${partido}$`, 'i') }).lean();
  if (zona) {
    return {
      partido,
      zonaId: zona._id,
      zonaNombre: zona.nombre,
      origen: 'partido'
    };
  }

  return { partido, zonaId: null, zonaNombre: null, origen: null };
}

module.exports = { resolverZonaPorCP };
