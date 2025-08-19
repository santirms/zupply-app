// backend/routes/asignaciones.js
const router = require('express').Router();
const { asignarViaQR, asignarViaMapa,
        listarAsignaciones, detalleAsignacion,
        quitarEnvios, moverEnvios, agregarEnvios,
       whatsappLink, eliminarAsignacion,
      } = require('../controllers/asignacionController');

// POST /api/asignaciones/qr
router.post('/qr', asignarViaQR);

// POST /api/asignaciones/mapa
router.post('/mapa', asignarViaMapa);
//HISTORIAL REMITOS
router.get('/', listarAsignaciones);
router.get('/:id', detalleAsignacion);
router.get('/:id/whatsapp', whatsappLink);
router.patch('/:id/remove', quitarEnvios);
router.patch('/:id/move', moverEnvios);
router.patch('/:id/add', agregarEnvios);      // agregar a un remito

router.delete('/:id', eliminarAsignacion);

module.exports = router;
