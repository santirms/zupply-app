const router = require('express').Router();
const ctrl = require('../controllers/authController');
const autenticarToken = require('../middlewares/autenticarToken');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar identifyTenant ANTES de login para saber a qué tenant pertenece
router.post('/login', identifyTenant, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', autenticarToken, ctrl.me);
// Verificar tenant para app móvil
router.get('/tenant-info', identifyTenant, async (req, res) => {
  // Obtener el subdomain del host
  const host = req.get('host') || '';
  const subdomain = host.split('.')[0]; // "transtech" de "transtech.zupply.tech"
  
  res.json({ 
    ok: true,
    name: subdomain
  });
});

module.exports = router;
