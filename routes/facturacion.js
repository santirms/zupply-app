const express = require('express');
const router  = express.Router();

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Lista   = require('../models/listaDePrecios');

const Partido    = require('../models/partidos');
const Zona       = require('../models/Zona');
const ZonaPorCP  = require('../models/ZonaPorCP');

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
      const cp = normCP(e.codigo_postal);
      let partido = e.partido || null;
      let zonaDoc = null;
      let zonaNombreN = null; // normalizado

      // 1) por CP (via ZonaPorCP)
      const nombreByCPn = cp ? cpToZonaNombre.get(cp) : null;
      if (nombreByCPn) {
        zonaNombreN = nombreByCPn;
        zonaDoc = nombreToZona.get(nombreByCPn) || null;
      }

      // 2) por partido si no hubo CP-match
      if (!zonaDoc && !zonaNombreN) {
        if (!partido && cp) partido = cpToPartido.get(cp) || null;
        if (partido) {
          const z = partidoToZona.get(normName(partido));
          if (z) { zonaDoc = z; zonaNombreN = normName(z.nombre); }
        }
      }

      // precio (prioridad: id; fallback: nombre)
      let precio = 0;
      if (zonaDoc) {
        const p = precioPorZonaId.get(String(zonaDoc._id));
        if (typeof p === 'number') precio = p;
      }
      if (!precio && zonaNombreN) {
        const p = precioPorZonaNombreN.get(zonaNombreN);
        if (typeof p === 'number') precio = p;
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
