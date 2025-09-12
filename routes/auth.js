const router = require('express').Router();
const ctrl = require('../controllers/authController');

console.log('authController is', typeof ctrl, ctrl && Object.keys(ctrl));

router.post('/login', ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me',      ctrl.me);
module.exports = router;
