const bcrypt = require('bcryptjs');
const slugify = require('../utils/slugify');
const User = require('../models/User');
const Chofer = require('../models/Chofer');
const Cliente = require('../models/Cliente');

const uniq = arr => Array.from(new Set(arr.filter(Boolean).map(String)));

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

const toPublicUser = (user = {}) => ({
  _id: user._id,
  username: user.username || null,
  email: user.email || null,
  role: user.role,
  activo: user.is_active !== false,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;

exports.listar = async (_req, res, next) => {
  try {
    const users = await User.find().select('-password_hash').sort({ createdAt: -1 }).lean();
    res.json({ ok: true, users: users.map(toPublicUser) });
  } catch (e) { next(e); }
};

exports.crear = async (req, res, next) => {
  try {
    let {
      email, username, phone, role, password,
      driver_id, chofer_nombre, chofer_telefono,
      sender_ids = [], cliente_id, activo
    } = req.body || {};

    if (!role) return res.status(400).json({ error: 'role requerido' });

    // === Soporte CHOFER (como ya tenías) ===
    if (role === 'chofer' && !driver_id) {
      if (!chofer_nombre || !chofer_telefono) {
        return res.status(400).json({ error: 'chofer_nombre y chofer_telefono requeridos para crear chofer' });
      }
      const nuevo = await Chofer.create({ nombre: chofer_nombre, telefono: chofer_telefono });
      driver_id = nuevo._id;
      phone = phone || String(chofer_telefono);
      username = username || slugify(chofer_nombre);
    }

    // === Soporte CLIENTE (NUEVO) ===
    if (role === 'cliente') {
      if (!email) return res.status(400).json({ error: 'email requerido para usuarios cliente' });

      // traer sender_id(s) del Cliente si viene cliente_id
      if (cliente_id) {
        const cli = await Cliente.findById(cliente_id).lean();
        if (cli?.sender_id) {
          sender_ids = uniq([...(Array.isArray(sender_ids) ? sender_ids : []), ...cli.sender_id]);
        }
      } else {
        sender_ids = uniq(Array.isArray(sender_ids) ? sender_ids : []);
      }
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
      email: email?.toLowerCase(),
      username: username || undefined,
      phone: phone || undefined,
      role,
      driver_id: driver_id || null,
      password_hash,
      is_active: parseBool(activo, true),
      must_change_password: !password,
      // ⬇ guarda el scope del cliente
      sender_ids: role === 'cliente' ? sender_ids : undefined,
      cliente_id: role === 'cliente' ? (cliente_id || null) : undefined
    });

    res.status(201).json({
      ok: true,
      user: toPublicUser(created),
      generated_password: password ? undefined : rawPass
    });
  } catch (e) { next(e); }
};

exports.actualizar = async (req, res, next) => {
  try {
    let { role, is_active, password, phone, sender_ids, cliente_id, username, email, activo } = req.body || {};
    const upd = {};
    if (role) upd.role = role;
    const parsedIsActive = parseBool(is_active, undefined);
    if (typeof parsedIsActive === 'boolean') upd.is_active = parsedIsActive;
    const parsedActivo = parseBool(activo, undefined);
    if (typeof parsedActivo === 'boolean') upd.is_active = parsedActivo;
    if (phone) upd.phone = phone;
    if (username) upd.username = slugify(username);
    if (email) upd.email = email.toLowerCase();

    if (password) {
      upd.password_hash = await bcrypt.hash(String(password), 12);
      upd.must_change_password = false;
    }

    // si se edita como cliente, mergear sender_ids con los del Cliente
    if (role === 'cliente' || typeof sender_ids !== 'undefined' || typeof cliente_id !== 'undefined') {
      let merged = Array.isArray(sender_ids) ? sender_ids : [];
      if (cliente_id) {
        const cli = await Cliente.findById(cliente_id).lean();
        if (cli?.sender_id) merged = uniq([...merged, ...cli.sender_id]);
        upd.cliente_id = cliente_id;
      }
      if (typeof sender_ids !== 'undefined') upd.sender_ids = uniq(merged);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, upd, { new: true });
    res.json({ ok: true, user: updated ? toPublicUser(updated) : null });
  } catch (e) { next(e); }
};

exports.crearCliente = async (req, res, next) => {
  try {
    // Forzamos role='cliente' y delegamos en crear
    req.body = { ...(req.body||{}), role: 'cliente' };
    return exports.crear(req, res, next);
  } catch (e) { next(e); }
};

exports.eliminar = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'No se puede eliminar el último administrador' });
      }
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
};
