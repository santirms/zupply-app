// routes/choferes.js
const router = require('express').Router();
const ctrl   = require('../controllers/choferController');

router.get('/',  ctrl.listarChoferes);
router.post('/', ctrl.crearChofer);

module.exports = router;
