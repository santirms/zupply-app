// routes/envios.js
const router = require('express').Router();
const ctrl   = require('../controllers/envioController');

// existentes (mismo comportamiento)
router.get('/',              ctrl.listar);
router.post('/guardar-masivo', ctrl.guardarMasivo);
router.post('/cargar-masivo',  ctrl.cargarMasivo);
router.post('/manual',         ctrl.guardarManual);
router.get('/del-dia',         ctrl.delDia);

// nuevos para panel choferes
router.get('/tracking/:tracking', ctrl.getByTracking);   // <-- QR
router.get('/asignados',          ctrl.asignados);       // <-- ruteo del día

// por ObjectId (dejar AL FINAL para no capturar las anteriores)
router.get('/:id',             ctrl.getById);

module.exports = router;

