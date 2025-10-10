// utils/resolvePartido.js
const Partido = require('../models/partidos');

function escapeRegex(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDirectionalSuffix(name = '') {
  return name.replace(/\s+(norte|sur|este|oeste|ne|no|se|so|n|s|e|o)$/i, '').trim();
}

function stripAccents(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function pickNombrePartido(doc) {
  if (!doc) return null;

  const candidatos = [doc.partido, doc.nombre, doc.nombre_partido];
  for (const value of candidatos) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

async function findByCodigoPostal(cp) {
  const candidatos = Array.isArray(cp) ? cp : [cp];
  const condiciones = [];

  candidatos.forEach(valor => {
    if (!valor) return;
    condiciones.push({ codigos_postales: valor }, { codigo_postal: valor });
  });

  if (!condiciones.length) return null;

  return Partido.findOne({ $or: condiciones }).lean();
}

async function resolvePartido(codigoPostal, nombrePartido = null) {
  try {
    if (codigoPostal) {
      const cpRaw = String(codigoPostal).trim();

      if (cpRaw) {
        const cpNoSpaces = cpRaw.replace(/\s+/g, '');
        const cpDigits = cpNoSpaces.replace(/\D/g, '');
        const cpCandidates = Array.from(new Set([cpNoSpaces, cpDigits])).filter(Boolean);

        const partidoCp = await findByCodigoPostal(cpCandidates);
        const nombreCp = pickNombrePartido(partidoCp);
        if (nombreCp) {
          console.log(`✓ Partido resuelto por CP ${cpRaw}: ${nombreCp}`);
          return nombreCp;
        }

        const prefijoFuente = cpDigits || cpNoSpaces;
        if (prefijoFuente && prefijoFuente.length >= 2) {
          const prefijo = prefijoFuente.slice(0, 2);
          const regex = new RegExp(`^${escapeRegex(prefijo)}`);

          const partidoPrefijo = await Partido.findOne({
            $or: [
              { codigos_postales: { $regex: regex } },
              { codigo_postal: { $regex: regex } }
            ]
          }).lean();

          const nombrePrefijo = pickNombrePartido(partidoPrefijo);
          if (nombrePrefijo) {
            console.log(`✓ Partido resuelto por prefijo ${prefijo}: ${nombrePrefijo}`);
            return nombrePrefijo;
          }
        }
      }
    }

    if (nombrePartido) {
      const nombreRaw = String(nombrePartido).trim();
      if (nombreRaw) {
        const regexExacto = new RegExp(`^${escapeRegex(nombreRaw)}$`, 'i');

        const partidoNombre = await Partido.findOne({
          $or: [
            { partido: { $regex: regexExacto } },
            { nombre: { $regex: regexExacto } }
          ]
        }).lean();

        const nombreExacto = pickNombrePartido(partidoNombre);
        if (nombreExacto) {
          console.log(`✓ Partido resuelto por nombre: ${nombreExacto}`);
          return nombreExacto;
        }

        const nombreStripped = stripDirectionalSuffix(nombreRaw);
        if (nombreStripped && nombreStripped !== nombreRaw) {
          const regexStripped = new RegExp(`^${escapeRegex(nombreStripped)}$`, 'i');
          const partidoStripped = await Partido.findOne({
            $or: [
              { partido: { $regex: regexStripped } },
              { nombre: { $regex: regexStripped } }
            ]
          }).lean();

          const nombreNormalizado = pickNombrePartido(partidoStripped);
          if (nombreNormalizado) {
            console.log(`✓ Partido resuelto por nombre normalizado: ${nombreNormalizado}`);
            return nombreNormalizado;
          }
        }

        const baseSimilar = stripAccents(stripDirectionalSuffix(nombreRaw)).replace(/\s+/g, ' ').trim();
        if (baseSimilar) {
          const regexSimilar = new RegExp(escapeRegex(baseSimilar), 'i');
          const partidoSimilar = await Partido.findOne({
            $or: [
              { partido: { $regex: regexSimilar } },
              { nombre: { $regex: regexSimilar } }
            ]
          }).lean();

          const nombreSimilar = pickNombrePartido(partidoSimilar);
          if (nombreSimilar) {
            console.log(`✓ Partido resuelto por similitud: ${nombreSimilar}`);
            return nombreSimilar;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error resolviendo partido:', error);
    return null;
  }
}

module.exports = { resolvePartido };
