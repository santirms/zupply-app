// backend/routes/asignaciones.js
const router = require('express').Router();
const { asignarViaQR, asignarViaMapa,
        listarAsignaciones, detalleAsignacion,
        quitarEnvios, moverEnvios, agregarEnvios, } = require('../controllers/asignacionController');

// POST /api/asignaciones/qr
router.post('/qr', asignarViaQR);

// POST /api/asignaciones/mapa
router.post('/mapa', asignarViaMapa);
//HISTORIAL REMITOS
router.get('/', listarAsignaciones);
router.get('/:id', detalleAsignacion);
router.patch('/:id/remove', quitarEnvios);
router.patch('/:id/move', moverEnvios);
router.patch('/:id/add', agregarEnvios);      // agregar a un remito

module.exports = router;
