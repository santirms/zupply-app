// backend/routes/asignaciones.js
const router = require('express').Router();
const { asignarViaQR, asignarViaMapa } = require('../controllers/asignacionController');

// POST /api/asignaciones/qr
router.post('/qr', asignarViaQR);

// POST /api/asignaciones/mapa
router.post('/mapa', asignarViaMapa);

module.exports = router;
