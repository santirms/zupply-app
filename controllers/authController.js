const bcrypt = require('bcryptjs');
const User = require('../models/User');

exports.login = async (req, res) => {
  try {
    const identifier = String(req.body.identifier || req.body.email || req.body.username || '')
      .trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const query = identifier.includes('@') ? { email: identifier } : { username: identifier };
    let u = await User.findOne({ ...query, is_active: true });
    if (!u && !identifier.includes('@')) {
      u = await User.findOne({ email: identifier, is_active: true });
    }
    if (!u) return res.status(400).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(400).json({ error: 'Credenciales inválidas' });

    // Regenerar la sesión evita fixation y asegura nuevo SID
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'No se pudo iniciar sesión' });

      req.session.user = {
        id: u._id.toString(),
        email: u.email,
        role: u.role,
        driver_id: u.driver_id || null,
        authenticated: true
      };

      u.last_login = new Date();
      await u.save();

      // Guardar la sesión antes de responder
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: 'No se pudo guardar la sesión' });
        return res.json({ ok: true, role: u.role, must_change_password: !!u.must_change_password });
      });
    });
  } catch (e) {
    console.error('POST /auth/login error', e);
    return res.status(500).json({ error: 'Error en login' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
};

