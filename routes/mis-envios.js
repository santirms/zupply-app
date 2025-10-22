const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middlewares/auth');
const misEnviosController = require('../controllers/misEnviosController');

// Obtener envíos activos del día para el chofer autenticado
router.get(
  '/activos',
  requireAuth,
  requireRole('chofer'),
  misEnviosController.getEnviosActivos
);

// Marcar estado manual de un envío
router.patch(
  '/:id/marcar-estado',
  requireAuth,
  requireRole('chofer'),
  misEnviosController.marcarEstado
);

module.exports = router;
