const router = require('express').Router();
const ctrl = require('../controllers/scanMeliController');

router.post('/', ctrl.scanAndUpsert);                 // /api/scan-meli << cambiar esta linea por "scanMeli" para el flujo de qrs o id internos
router.get('/latest-render/:id', ctrl.latestQr);      // /api/scan-meli/latest-render/:id

module.exports = router;
