// controllers/authController.js
const bcrypt = require('bcryptjs');
const User   = require('../models/User');

exports.login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    // email vs username (y opcionalmente phone si querés)
    const id = String(identifier).trim().toLowerCase();
    const isEmail = id.includes('@');

    const query = isEmail
      ? { email: id }
      : { $or: [ { username: id }, { username: id.toLowerCase() } ] }; // podrías sumar { phone: identifier }

    // 👇 MUY IMPORTANTE: traer el hash explícitamente
    const user = await User.findOne(query)
      .select('+password_hash +role +driver_id +is_active +email +username');

    if (!user) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' });

    const ok = await bcrypt.compare(String(password), user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });

    // sesión
    req.session.user = {
      authenticated: true,
      _id: user._id,
      role: user.role,
      email: user.email,
      username: user.username,
      driver_id: user.driver_id || null
    };

    user.last_login = new Date();
    await user.save();

    return res.json({ ok: true, role: user.role });
  } catch (e) {
    next(e);
  }
};
