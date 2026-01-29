const router = require('express').Router();
const ctrl = require('../controllers/scanMeliController');
const identifyTenant = require('../middlewares/identifyTenant');

router.post('/', identifyTenant, ctrl.scanAndUpsert);                 // /api/scan-meli << cambiar esta linea por "scanMeli" para el flujo de qrs o id internos
router.get('/latest-render/:id', ctrl.latestQr);      // /api/scan-meli/latest-render/:id

module.exports = router;
