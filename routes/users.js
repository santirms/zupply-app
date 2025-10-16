// routes/users.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middlewares/auth');
const ctrl = require('../controllers/usersController');
const User = require('../models/User');
const Chofer = require('../models/Chofer');
const slugify = require('../utils/slugify');

// Todas las rutas de /api/users requieren estar logueado
router.use(requireAuth);

router.get('/me', (req, res) => {
  const u = req.session?.user;
  if (!u?.authenticated) return res.status(401).json({ error: 'No autenticado' });
  res.json({
    _id: u._id || null,
    username: u.username || null,
    email: u.email || null,
    role: u.role,
    cliente_id: u.cliente_id || null,
    sender_ids: Array.isArray(u.sender_ids) ? u.sender_ids : []
  });
});

// ── ADMIN-ONLY ────────────────────────────────────────────────
// Crear usuario cliente (fuerza role='cliente' en el controller)
router.post('/create-client', requireRole('admin'), ctrl.crearCliente);

// Alta genérica de usuarios (admin/coordinador/chofer, etc.)
router.post('/', requireRole('admin'), ctrl.crear);

// Actualizar parcial (legacy)
router.patch('/:id', requireRole('admin'), ctrl.actualizar);

// ── LECTURA ──────────────────────────────────────────────────
// Listar: admin o coordinador (ajustá si querés que sea solo admin)
router.get('/', requireRole('admin','coordinador'), async (_req, res) => {
  try {
    const users = await User.find()
      .select('-password_hash')
      .populate('driver_id', 'nombre telefono activo')
      .sort({ createdAt: -1 });

    res.json(users.map(toPublicUser));
  } catch (err) {
    console.error('Error listando usuarios:', err);
    res.status(500).json({ error: err.message });
  }
});

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
  const driverRaw = plain.driver_id;
  const driverPlain = driverRaw && typeof driverRaw.toObject === 'function' ? driverRaw.toObject() : driverRaw;
  const driverData = driverPlain
    ? {
        _id: driverPlain._id,
        nombre: driverPlain.nombre || null,
        telefono: driverPlain.telefono || null,
        activo: driverPlain.activo !== false
      }
    : null;

  return {
    _id: plain._id,
    username: plain.username,
    email: plain.email,
    role: plain.role,
    activo: plain.is_active !== false,
    driver_id: driverData,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt
  };
};

// Actualizar usuario (solo admin)
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, activo, password, chofer_nombre, chofer_telefono } = req.body || {};

    const userActual = await User.findById(id).populate('driver_id');

    if (!userActual) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

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
      updateData.email = mail || undefined;
    }

    let finalRole = userActual.role;
    if (typeof role !== 'undefined') {
      updateData.role = role;
      finalRole = role;
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

    if (finalRole === 'chofer') {
      const nombreTrim = typeof chofer_nombre === 'string' ? chofer_nombre.trim() : '';
      const telefonoTrim = typeof chofer_telefono === 'string' ? chofer_telefono.trim() : '';

      if (!userActual.driver_id && (!nombreTrim || !telefonoTrim)) {
        return res.status(400).json({ error: 'chofer_nombre y chofer_telefono requeridos para chofer' });
      }

      if (userActual.driver_id) {
        const updateChofer = {};
        if (nombreTrim) updateChofer.nombre = nombreTrim;
        if (telefonoTrim) updateChofer.telefono = telefonoTrim;

        if (Object.keys(updateChofer).length) {
          await Chofer.findByIdAndUpdate(userActual.driver_id._id, { $set: updateChofer });
        }
      } else if (nombreTrim && telefonoTrim) {
        const nuevoChofer = await Chofer.create({
          nombre: nombreTrim,
          telefono: telefonoTrim,
          activo: true
        });
        updateData.driver_id = nuevoChofer._id;
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .select('-password_hash')
      .populate('driver_id', 'nombre telefono activo');

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

    console.log(`🗑️ Intentando eliminar usuario: ${id}`);

    const user = await User.findById(id);
    if (!user) {
      console.warn(`❌ Usuario no encontrado: ${id}`);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    console.log(`📋 Usuario encontrado: ${user.username || user.email} (${user.role})`);

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin', is_active: { $ne: false } });
      if (adminCount <= 1) {
        console.warn('❌ No se puede eliminar el último admin');
        return res.status(400).json({ error: 'No se puede eliminar el último administrador' });
      }
    }

    if (user.driver_id) {
      console.log(`🚛 Eliminando chofer asociado: ${user.driver_id}`);
      try {
        await Chofer.findByIdAndDelete(user.driver_id);
        console.log(`✓ Chofer eliminado: ${user.driver_id}`);
      } catch (driverErr) {
        console.error(`⚠️ Error eliminando chofer: ${driverErr.message}`);
      }
    }

    await User.findByIdAndDelete(id);
    console.log(`✓ Usuario eliminado: ${user.username || user.email || id}`);

    res.json({
      ok: true,
      message: 'Usuario eliminado correctamente',
      username: user.username
    });
  } catch (err) {
    console.error('❌ Error eliminando usuario:', err);
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
