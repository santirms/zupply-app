const router = require('express').Router();
const ctrl = require('../controllers/authController');
const autenticarToken = require('../middlewares/autenticarToken');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar identifyTenant ANTES de login para saber a qué tenant pertenece
router.post('/login', identifyTenant, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', autenticarToken, ctrl.me);
// Verificar tenant para app móvil
router.get('/tenant-info', identifyTenant, (req, res) => {
  res.json({ 
    ok: true,
    name: req.tenantId
  });
});

module.exports = router;
