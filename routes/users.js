// routes/users.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/usersController');
const User = require('../models/User');
const slugify = require('../utils/slugify');

// Todas las rutas de /api/users requieren estar logueado
router.use(requireAuth);

// ── ADMIN-ONLY ────────────────────────────────────────────────
// Crear usuario cliente (fuerza role='cliente' en el controller)
router.post('/create-client', requireRole('admin'), ctrl.crearCliente);

// Alta genérica de usuarios (admin/coordinador/chofer, etc.)
router.post('/', requireRole('admin'), ctrl.crear);

// Actualizar parcial (legacy)
router.patch('/:id', requireRole('admin'), ctrl.actualizar);

// ── LECTURA ──────────────────────────────────────────────────
// Listar: admin o coordinador (ajustá si querés que sea solo admin)
router.get('/', requireRole('admin','coordinador'), ctrl.listar);

const parseBool = (value, defaultValue) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (normalized === '') return defaultValue;
  }
  if (typeof value === 'number') return value !== 0;
  return defaultValue;
};

const toPublicUser = (user) => {
  if (!user) return null;
  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  return {
    _id: plain._id,
    username: plain.username,
    email: plain.email,
    role: plain.role,
    activo: plain.is_active !== false,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt
  };
};

// Actualizar usuario (solo admin)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, activo, password } = req.body || {};

    const updateData = {};

    if (typeof username !== 'undefined') {
      const slug = slugify(String(username));
      if (!slug) {
        return res.status(400).json({ error: 'Usuario inválido' });
      }
      updateData.username = slug;
    }
    if (typeof email !== 'undefined') {
      const mail = String(email).trim().toLowerCase();
      if (!mail) {
        return res.status(400).json({ error: 'Email inválido' });
      }
      updateData.email = mail;
    }
    if (typeof role !== 'undefined') {
      updateData.role = role;
    }
    if (typeof activo !== 'undefined') {
      const parsed = parseBool(activo, undefined);
      if (typeof parsed === 'boolean') {
        updateData.is_active = parsed;
      }
    }

    const cleanPassword = typeof password === 'string' ? password.trim() : '';
    if (cleanPassword) {
      updateData.password_hash = await bcrypt.hash(cleanPassword, 12);
      updateData.must_change_password = false;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password_hash');

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, user: toPublicUser(user) });
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar usuario (solo admin)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'No se puede eliminar el último administrador' });
      }
    }

    await User.findByIdAndDelete(id);
    res.json({ ok: true, message: 'Usuario eliminado' });
  } catch (err) {
    console.error('Error eliminando usuario:', err);
    res.status(500).json({ error: err.message });
  }
});

// Toggle activo (solo admin)
router.patch('/:id/toggle-activo', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    user.is_active = !user.is_active;
    await user.save();

    res.json({ ok: true, activo: user.is_active });
  } catch (err) {
    console.error('Error toggling activo:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
