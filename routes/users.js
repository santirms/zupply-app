// routes/users.js
const router = require('express').Router();
const { requireAuth, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/usersController');

// Todas las rutas de /api/users requieren estar logueado
router.use(requireAuth);

// ── ADMIN-ONLY ────────────────────────────────────────────────
// Crear usuario cliente (fuerza role='cliente' en el controller)
router.post('/create-client', requireRole('admin'), ctrl.crearCliente);

// Alta genérica de usuarios (admin/coordinador/chofer, etc.)
router.post('/', requireRole('admin'), ctrl.crear);

// Actualizar / eliminar usuario
router.patch('/:id', requireRole('admin'), ctrl.actualizar);
router.delete('/:id', requireRole('admin'), ctrl.eliminar);

// ── LECTURA ──────────────────────────────────────────────────
// Listar: admin o coordinador (ajustá si querés que sea solo admin)
router.get('/', requireRole('admin','coordinador'), ctrl.listar);

module.exports = router;
