const router = require('express').Router();
const { requireAuth, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/usersController');

// 👉 Solo ADMIN puede crear usuarios cliente
router.post('/create-client', requireRole('admin'), usersCtl.crearCliente);
router.post('/', requireRole('admin'), usersCtl.crear);

router.use(requireAuth, requireRole('admin'));

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);         // crea admin/coordinador/chofer (opcionalmente vinculado a chofer)
router.patch('/:id', ctrl.actualizar);// cambiar rol, activar/desactivar, reset pass, etc.
router.delete('/:id', ctrl.eliminar);

module.exports = router;
