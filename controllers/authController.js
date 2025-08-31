const bcrypt = require('bcryptjs');
const User = require('../models/User');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const u = await User.findOne({ email, is_active: true });
  if (!u) return res.status(400).json({ error: 'Credenciales inválidas' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(400).json({ error: 'Credenciales inválidas' });

  req.session.user = {
    id: u._id.toString(),
    email: u.email,
    role: u.role,
    driver_id: u.driver_id || null,
    authenticated: true
  };

  u.last_login = new Date();
  await u.save();
  res.json({ ok: true, role: u.role });
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
};
