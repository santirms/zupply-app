const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scanMeliController');
const { isAuthenticated } = require('../middlewares/auth');

router.post('/', isAuthenticated, ctrl.scanMeli);

module.exports = router;
