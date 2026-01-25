const router = require('express').Router();
const { requireAuth, requireRole } = require('../middlewares/auth');
const identifyTenant = require('../middlewares/identifyTenant');
const ctrl   = require('../controllers/choferController');

router.use(requireAuth);
router.use(identifyTenant);
router.get('/asignados', requireRole('admin','coordinador'), ctrl.asignadosDelDia);
router.post('/asignar-por-qr', requireRole('admin','coordinador'), ctrl.asignarPorQR);
router.post('/asignar-desde-mapa', requireRole('admin','coordinador'), ctrl.asignarDesdeMapa);

// CRUD choferes
router.get('/',  ctrl.listarChoferes);
router.post('/', requireRole('admin','coordinador'), ctrl.crearChofer);

module.exports = router;
