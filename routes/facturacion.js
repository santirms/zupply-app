const express = require('express');
const router  = express.Router();

const Envio   = require('../models/Envio');
const Cliente = require('../models/Cliente');
const Lista   = require('../models/listaDePrecios');

const Partido    = require('../models/partidos');
const Zona       = require('../models/Zona');
const ZonaPorCP  = require('../models/ZonaPorCP');

// Helpers: construir mapas una sola vez por request
async function buildMapsForEnvios(envios) {
  // 1) Set de CPs únicos del lote
  const cps = new Set();
  for (const e of envios) if (e.codigo_postal) cps.add(String(e.codigo_postal).trim());

  // 2) Map CP -> nombreZona (desde ZonaPorCP)
  const zcpDocs = await ZonaPorCP.find({ codigos_postales: { $in: Array.from(cps) } })
                                 .select('nombre codigos_postales').lean();
  const cpToZonaNombre = new Map();
  for (const z of zcpDocs) {
    for (const cp of z.codigos_postales || []) {
      cpToZonaNombre.set(String(cp).trim(), z.nombre);
    }
  }

  // 3) Map nombreZona -> Zona (_id) y Map partido -> Zona (_id, nombre)
  const zonas = await Zona.find({}).select('nombre partidos').lean();
  const nombreToZona   = new Map();  // nombre (case-insensitive) -> zonaDoc
  const partidoToZona  = new Map();  // partido (case-insensitive) -> zonaDoc
  for (const z of zonas) {
    nombreToZona.set(z.nombre.toLowerCase(), z);
    for (const p of (z.partidos || [])) {
      partidoToZona.set(String(p).toLowerCase(), z);
    }
  }

  // 4) Partidos para CPs que no tengan zona por CP
  const cpsSinZona = Array.from(cps).filter(cp => !cpToZonaNombre.has(cp));
  let cpToPartido = new Map();
  if (cpsSinZona.length) {
    const parts = await Partido.find({ codigo_postal: { $in: cpsSinZona } })
                               .select('codigo_postal partido').lean();
    cpToPartido = new Map(parts.map(p => [String(p.codigo_postal).trim(), p.partido]));
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

    const lista = await Lista.findById(cliente.lista_precios).lean();
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

    // --- Mapas para resolver rápido ---
    const { cpToZonaNombre, nombreToZona, partidoToZona, cpToPartido } = await buildMapsForEnvios(envios);

    // Pre-map de precios por zonaId para lookup O(1)
    const precioPorZonaId = new Map();
    for (const z of (lista.zonas || [])) {
      precioPorZonaId.set(String(z.zona), Number(z.precio) || 0);
    }

    const items = [];
    let total = 0;

    for (const e of envios) {
      const cp = String(e.codigo_postal || '').trim();
      let zonaDoc = null;
      let zonaNombre = null;
      let partido = e.partido || null;

      // 1) Intento por CP directo (ZonaPorCP)
      const nombreByCP = cpToZonaNombre.get(cp);
      if (nombreByCP) {
        zonaNombre = nombreByCP;
        const z = nombreToZona.get(nombreByCP.toLowerCase());
        if (z) zonaDoc = z;
      } else {
        // 2) Resuelvo partido por CP si no vino
        if (!partido) partido = cpToPartido.get(cp) || null;
        // 3) Intento por partido
        if (partido) {
          const z = partidoToZona.get(String(partido).toLowerCase());
          if (z) { zonaDoc = z; zonaNombre = z.nombre; }
        }
      }

      let precio = 0;
      if (zonaDoc) {
        const p = precioPorZonaId.get(String(zonaDoc._id));
        if (typeof p === 'number') precio = p;
      }

      items.push({
        tracking: e.id_venta || e.meli_id || '',
        cliente:  e.cliente_id?.nombre || '',
        codigo_interno: e.cliente_id?.codigo_cliente || '',
        sender_id: e.sender_id || '',
        partido,
        zona: zonaNombre,
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
