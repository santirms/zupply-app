const express = require('express');
const router  = express.Router();

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Lista   = require('../models/listaDePrecios');

const Partido    = require('../models/partidos');
const Zona       = require('../models/Zona');
const ZonaPorCP  = require('../models/ZonaPorCP');

const { resolverZonaPorCP } = require('../services/zonaResolver'); // <- el de la 1ra versión

// ---- helpers de normalización ----
const rmDiacritics = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normName     = s => rmDiacritics(String(s||'').trim().toLowerCase());
const normCP       = s => String(s||'').replace(/\D/g,'').trim(); // solo dígitos

async function buildMapsForEnvios(envios) {
  // 1) set de CPs normalizados
  const cps = new Set();
  for (const e of envios) {
    const cp = normCP(e.codigo_postal);
    if (cp) cps.add(cp);
  }

  // 2) CP -> nombreZona (desde ZonaPorCP)
  const zcpDocs = cps.size
    ? await ZonaPorCP.find({ codigos_postales: { $in: Array.from(cps) } })
        .select('nombre codigos_postales').lean()
    : [];
  const cpToZonaNombre = new Map();
  for (const z of zcpDocs) {
    const zname = normName(z.nombre);
    for (const cp of (z.codigos_postales || [])) {
      const cpn = normCP(cp);
      if (cpn) cpToZonaNombre.set(cpn, zname);
    }
  }

  // 3) Map nombreZona -> ZonaDoc y Map partido -> ZonaDoc
  const zonas = await Zona.find({}).select('nombre partidos').lean();
  const nombreToZona   = new Map();  // nombre normalizado -> zonaDoc
  const partidoToZona  = new Map();  // partido normalizado -> zonaDoc
  for (const z of zonas) {
    nombreToZona.set(normName(z.nombre), z);
    for (const p of (z.partidos || [])) {
      partidoToZona.set(normName(p), z);
    }
  }

  // 4) CP -> partido (sólo para cps sin zona por CP)
  const cpsSinZona = Array.from(cps).filter(cp => !cpToZonaNombre.has(cp));
  let cpToPartido = new Map();
  if (cpsSinZona.length) {
    const parts = await Partido.find({ codigo_postal: { $in: cpsSinZona } })
                               .select('codigo_postal partido').lean();
    cpToPartido = new Map(
      parts.map(p => [ normCP(p.codigo_postal), p.partido ])
    );
  }

  return { cpToZonaNombre, nombreToZona, partidoToZona, cpToPartido };
}

function getPrecioFromLista(lista, zonaDoc, zonaNombreN) {
  // Map por id
  const precioPorZonaId = new Map();
  // Map por nombre normalizado
  const precioPorZonaNombreN = new Map();

  for (const z of (lista.zonas || [])) {
    const pid = String(z.zona?._id || z.zona || '');
    const precio = Number(z.precio) || 0;
    if (pid) precioPorZonaId.set(pid, precio);
    const zname = z.zona?.nombre
      ? (z.zona.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase())
      : null;
    if (zname) precioPorZonaNombreN.set(zname, precio);
  }

  if (zonaDoc) {
    const p = precioPorZonaId.get(String(zonaDoc._id));
    if (typeof p === 'number') return p;
  }
  if (zonaNombreN) {
    const p = precioPorZonaNombreN.get(zonaNombreN);
    if (typeof p === 'number') return p;
  }
  return 0;
}

router.get('/preview', async (req, res) => {
  try {
    const { clienteId, desde, hasta } = req.query;
    if (!clienteId || !desde || !hasta)
      return res.status(400).json({ error: 'Parámetros requeridos: clienteId, desde, hasta' });

    const dtFrom = new Date(desde);
    const dtTo   = new Date(hasta);
    if (isNaN(dtFrom) || isNaN(dtTo))
      return res.status(400).json({ error: 'Fechas inválidas' });

    const cliente = await Cliente.findById(clienteId).lean();
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    // ⬅️ poblamos zonas.zona para tener también el NOMBRE (clave para fallback por nombre)
    const lista = await Lista.findById(cliente.lista_precios)
                             .populate('zonas.zona', 'nombre')
                             .lean();
    if (!lista) return res.status(404).json({ error: 'Lista de precios no encontrada' });

    // Envíos del periodo para ese cliente (por cliente_id o por sender_id)
    const or = [{ cliente_id: cliente._id }];
    if (Array.isArray(cliente.sender_id) && cliente.sender_id.length) {
      for (const s of cliente.sender_id) or.push({ sender_id: s });
    }

    const envios = await Envio.find({
      fecha: { $gte: dtFrom, $lte: dtTo },
      $or: or
    })
    .select('id_venta meli_id cliente_id sender_id partido codigo_postal fecha estado precio')
    .sort({ fecha: 1 })
    .populate('cliente_id', 'nombre codigo_cliente')
    .lean();

    // --- mapas en memoria ---
    const { cpToZonaNombre, nombreToZona, partidoToZona, cpToPartido } = await buildMapsForEnvios(envios);

    // Precio por zonaId y también por NOMBRE (normalizado)
    const precioPorZonaId      = new Map();
    const precioPorZonaNombreN = new Map();
    for (const z of (lista.zonas || [])) {
      const pid = String(z.zona?._id || z.zona || '');
      const precio = Number(z.precio) || 0;
      if (pid) precioPorZonaId.set(pid, precio);
      const zname = z.zona?.nombre ? normName(z.zona.nombre) : null;
      if (zname) precioPorZonaNombreN.set(zname, precio);
    }

    const items = [];
    let total = 0;

    for (const e of envios) {
     // --- Resolución rápida (maps) como ya venías haciendo ---
const cp = normCP(e.codigo_postal);
let partido = e.partido || null;
let zonaDoc = null;
let zonaNombreN = null;

// 1) Intento por CP (via ZonaPorCP -> nombre de zona)
const nombreByCPn = cp ? cpToZonaNombre.get(cp) : null;
if (nombreByCPn) {
  zonaNombreN = nombreByCPn;
  zonaDoc = nombreToZona.get(nombreByCPn) || null;

  // ⚠️ Si encontramos nombre por CP pero NO existe Zona con ese nombre,
  //    NO nos quedamos acá: caemos al flujo por partido.
  if (!zonaDoc) {
    if (!partido && cp) partido = cpToPartido.get(cp) || null;
    if (partido) {
      const z = partidoToZona.get(normName(partido));
      if (z) { zonaDoc = z; zonaNombreN = normName(z.nombre); }
    }
  }
} else {
  // 2) Sin match por CP: voy directo por partido
  if (!partido && cp) partido = cpToPartido.get(cp) || null;
  if (partido) {
    const z = partidoToZona.get(normName(partido));
    if (z) { zonaDoc = z; zonaNombreN = normName(z.nombre); }
  }
}


// Precio con lookup rápido
let precio = getPrecioFromLista(lista, zonaDoc, zonaNombreN);

// ---------- FALLBACK “lento” SOLO SI SIGUE EN $0 ----------
if (!precio) {
  try {
    const rz = await resolverZonaPorCP(e.codigo_postal, e.partido); // <- versión lenta
    const zonaIdFallback = rz.zonaId;
    const zonaNombreNFallback = rz.zonaNombre
      ? normName(rz.zonaNombre)
      : null;

    // Intentamos de nuevo con la info del resolver lento
    if (!zonaDoc && zonaIdFallback) {
      // Si tenemos id, buscá la Zona en nombreToZona por nombre o directamente arma un doc mínimo
      zonaDoc = nombreToZona.get(zonaNombreNFallback) || { _id: zonaIdFallback, nombre: rz.zonaNombre };
      zonaNombreN = zonaNombreNFallback;
    } else if (!zonaNombreN && rz.zonaNombre) {
      zonaNombreN = zonaNombreNFallback;
    }
    // Recalcular precio
    precio = getPrecioFromLista(lista, zonaDoc, zonaNombreN);
  } catch (err) {
    // log mínimo para diagnóstico sin romper flujo
    console.warn('[preview:fallback:error]', e.codigo_postal, err.message);
  }
}

      items.push({
        tracking: e.id_venta || e.meli_id || '',
        cliente:  e.cliente_id?.nombre || '',
        codigo_interno: e.cliente_id?.codigo_cliente || '',
        sender_id: e.sender_id || '',
        partido,
        zona: zonaDoc?.nombre || (zonaNombreN ? rmDiacritics(zonaNombreN).toUpperCase() : null),
        precio,
        fecha: e.fecha,
        estado: e.estado
      });

      total += precio;
    }

    res.json({ count: items.length, total, items });
  } catch (err) {
    console.error('[facturacion/preview] error:', err);
    res.status(500).json({ error: 'Error generando preview' });
  }
});

module.exports = router;
