const router = require('express').Router();
const ctrl = require('../controllers/scanMeliController');

router.post('/', ctrl.scanMeli);                 // /api/scan-meli
router.get('/latest-render/:id', ctrl.latestQr);      // /api/scan-meli/latest-render/:id

module.exports = router;
