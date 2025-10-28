const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scanMeliController');
const { optionalAuth } = require('../middlewares/auth');

router.post('/', ctrl.scanMeli);

module.exports = router;
