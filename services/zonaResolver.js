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

/**
 * Similar a resolverZonaPorCP pero SOLO matchea contra las zonas
 * que están en la lista de precios del cliente.
 *
 * @param {string} cp - Código postal
 * @param {string} partidoHint - Nombre del partido (fallback)
 * @param {Array} zonasDelCliente - Array de { zona: ObjectId|{_id, nombre, partidos}, precio }
 * @returns {Promise<{partido, zonaId, zonaNombre, origen}>}
 */
async function resolverZonaParaCliente(cp, partidoHint = null, zonasDelCliente = []) {
  const cpStr = String(cp || '').trim();

  if (!Array.isArray(zonasDelCliente) || zonasDelCliente.length === 0) {
    // Fallback al método original si no hay zonas del cliente
    return await resolverZonaPorCP(cpStr, partidoHint);
  }

  // Extraer IDs y nombres de las zonas del cliente
  const zonasIds = zonasDelCliente
    .map(z => z.zona?._id || z.zona)
    .filter(Boolean)
    .map(id => String(id));

  // 1) Intentar por CP en ZonaPorCP
  if (cpStr) {
    const zcp = await ZonaPorCP.findOne({ codigos_postales: cpStr }).lean();
    if (zcp) {
      // Verificar si esta zona está en la lista del cliente
      const zonaMatch = zonasDelCliente.find(z => {
        const nombreZona = z.zona?.nombre;
        return nombreZona && nombreZona.toLowerCase() === zcp.nombre.toLowerCase();
      });

      if (zonaMatch) {
        return {
          partido: null,
          zonaId: zonaMatch.zona?._id || zonaMatch.zona,
          zonaNombre: zcp.nombre,
          origen: 'cp'
        };
      }
    }
  }

  // 2) Resolver partido por CP
  let partido = partidoHint;
  if (!partido && cpStr) {
    const pdoc = await Partido.findOne({ codigo_postal: cpStr }).lean();
    partido = pdoc?.partido || null;
  }

  if (!partido) {
    return { partido: null, zonaId: null, zonaNombre: null, origen: null };
  }

  // 3) Buscar qué zona del cliente contiene este partido
  // CRÍTICO: Buscar SOLO en las zonas del cliente, no en todas
  const zona = await Zona.findOne({
    _id: { $in: zonasIds },
    partidos: new RegExp(`^${partido}$`, 'i')
  }).lean();

  if (zona) {
    return {
      partido,
      zonaId: zona._id,
      zonaNombre: zona.nombre,
      origen: 'partido'
    };
  }

  // 4) Si no encontró match, devolver null
  return { partido, zonaId: null, zonaNombre: null, origen: null };
}

module.exports = { resolverZonaPorCP, resolverZonaParaCliente };
