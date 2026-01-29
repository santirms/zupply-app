const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scanMeliController');
const { optionalAuth } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');

router.post('/', identifyTenant, ctrl.scanMeli);

module.exports = router;
