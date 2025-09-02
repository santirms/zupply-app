const bcrypt = require('bcryptjs');
const slugify = require('../utils/slugify');
const User = require('../models/User');
const Chofer = require('../models/Chofer');

exports.listar = async (_req, res, next) => {
  try {
    const users = await User.find().select('-password_hash').lean();
    res.json({ users });
  } catch (e) { next(e); }
};

exports.crear = async (req, res, next) => {
  try {
    let { email, username, phone, role, password, driver_id, chofer_nombre, chofer_telefono } = req.body || {};

    if (!role) return res.status(400).json({ error: 'role requerido' });

    // Si es chofer y no viene driver_id pero sí nombre/teléfono, crear Chofer primero
    if (role === 'chofer' && !driver_id) {
      if (!chofer_nombre || !chofer_telefono) {
        return res.status(400).json({ error: 'chofer_nombre y chofer_telefono requeridos para crear chofer' });
      }
      const nuevo = await Chofer.create({ nombre: chofer_nombre, telefono: chofer_telefono });
      driver_id = nuevo._id;
      // si no vino username/phone/password, derivarlos
      phone = phone || String(chofer_telefono);
      username = username || slugify(chofer_nombre);
    }

    // username único si viene
    if (username) {
      username = slugify(username);
      let u = username, i = 1;
      while (await User.findOne({ username: u })) u = `${username}${++i}`;
      username = u;
    }

    // password por prioridad: explícito || phone || random
    const rawPass = password || phone || Math.random().toString(36).slice(2,10);
    const password_hash = await bcrypt.hash(String(rawPass), 12);

    const created = await User.create({
      email: email ? String(email).toLowerCase() : undefined,
      username: username || undefined,
      phone: phone || undefined,
      role,
      driver_id: driver_id || null,
      password_hash,
      is_active: true,
      must_change_password: !password // si no definiste pass explícito, forzar cambio
    });

    res.status(201).json({ id: created._id, username: created.username, email: created.email, generated_password: password ? undefined : rawPass });
  } catch (e) { next(e); }
};

exports.actualizar = async (req, res, next) => {
  try {
    const { role, is_active, password, phone } = req.body || {};
    const upd = {};
    if (role) upd.role = role;
    if (typeof is_active === 'boolean') upd.is_active = is_active;
    if (phone) upd.phone = phone;
    if (password) {
      upd.password_hash = await bcrypt.hash(String(password), 12);
      upd.must_change_password = false;
    }
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
