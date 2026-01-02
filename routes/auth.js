const router = require('express').Router();
const ctrl = require('../controllers/authController');
const autenticarToken = require('../middlewares/autenticarToken');

router.post('/login', ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', autenticarToken, ctrl.me);

module.exports = router;
