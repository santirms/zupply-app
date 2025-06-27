// routes/zonaPorCp.js
const express = require('express');
const router = express.Router();
const { buscarZonaPorCP } = require('../utils/zonaUtils');

router.get('/:cp', async (req, res) => {
  const cp = req.params.cp;
  try {
    const zona = await buscarZonaPorCP(cp);
    if (zona) {
      res.json(zona);
    } else {
      res.status(404).json({ error: 'Zona no encontrada para ese código postal' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;