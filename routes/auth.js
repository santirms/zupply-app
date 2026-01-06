const router = require('express').Router();
const ctrl = require('../controllers/authController');
const autenticarToken = require('../middlewares/autenticarToken');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar identifyTenant ANTES de login para saber a qué tenant pertenece
router.post('/login', identifyTenant, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', autenticarToken, ctrl.me);

module.exports = router;
