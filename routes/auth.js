const router = require('express').Router();
const ctrl = require('../controllers/authController');
router.post('/login', ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me',      ctrl.me);
module.exports = router;
