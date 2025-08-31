const bcrypt = require('bcryptjs');
const User = require('../models/User');

exports.listar = async (req, res, next) => {
  try {
    const users = await User.find().select('-password_hash').lean();
    res.json({ users });
  } catch (e) { next(e); }
};

exports.crear = async (req, res, next) => {
  try {
    const { email, role, password, driver_id } = req.body;
    const password_hash = await bcrypt.hash(password, 12);
    const u = await User.create({ email, role, password_hash, driver_id: driver_id || null });
    res.status(201).json({ id: u._id });
  } catch (e) { next(e); }
};

exports.actualizar = async (req, res, next) => {
  try {
    const { role, is_active, password, driver_id } = req.body;
    const upd = {};
    if (role) upd.role = role;
    if (typeof is_active === 'boolean') upd.is_active = is_active;
    if (driver_id !== undefined) upd.driver_id = driver_id || null;
    if (password) upd.password_hash = await bcrypt.hash(password, 12);

    await User.findByIdAndUpdate(req.params.id, upd);
    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.eliminar = async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
};
