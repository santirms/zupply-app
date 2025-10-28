const express = require('express');
const router = express.Router();
const Envio = require('../models/Envio');

/**
 * Endpoint PÚBLICO para tracking
 * GET /api/tracking/:tracking
 */
router.get('/:tracking', async (req, res) => {
  try {
    const { tracking } = req.params;

    console.log(`[TRACKING] Consulta pública para: ${tracking}`);

    // Buscar por tracking o id_venta
    const envio = await Envio.findOne({
      $or: [
        { tracking: tracking },
        { id_venta: tracking }
      ]
    })
    .select('tracking id_venta destinatario direccion codigo_postal partido estado fecha historial')
    .lean();

    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Datos públicos (sin info sensible)
    res.json({
      tracking: envio.tracking || envio.id_venta,
      id_venta: envio.id_venta,
      destinatario: envio.destinatario,
      direccion: envio.direccion,
      codigo_postal: envio.codigo_postal,
      partido: envio.partido,
      estado: envio.estado,
      fecha: envio.fecha,
      historial: envio.historial || []
    });

  } catch (err) {
    console.error('[TRACKING] Error:', err);
    res.status(500).json({ error: 'Error al consultar el envío' });
  }
});

module.exports = router;
