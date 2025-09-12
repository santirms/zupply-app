const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const slugify = require('../utils/slugify');
const Envio  = require('../models/Envio');
const Chofer = require('../models/Chofer');
const User   = require('../models/User');

/* ====== YA TENÍAS: listar choferes ====== */
exports.listarChoferes = async (_req, res) => {
  try {
    const choferes = await Chofer.find().sort('nombre');
    res.json(choferes);
  } catch (err) { console.error(err); res.status(500).json({ msg: 'Error al listar choferes' }); }
};

/* ====== NUEVO: crear chofer + usuario (rol chofer) ====== */
exports.crearChofer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { nombre, telefono, email } = req.body || {};
    if (!nombre || !telefono) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ msg: 'Faltan nombre o teléfono' });
    }

    // 1) Crear Chofer (en sesión)
    const [{ _id: choferId }] = await Chofer.create([{ nombre, telefono }], { session });

    // 2) username único slugificado
    const base = slugify(nombre);
    let username = base, i = 1;
    while (await User.findOne({ username }).session(session)) {
      username = `${base}${++i}`;
    }

    // 3) Preparar User (rol chofer). Si tu esquema exige email, usamos el provisto;
    //    si no viene, dejamos undefined (ver #2 abajo para esquema).
    const password_hash = await bcrypt.hash(String(telefono), 12);
    const [user] = await User.create([{
      username,
      email: email ? String(email).toLowerCase() : undefined,
      phone: String(telefono),
      role: 'chofer',
      driver_id: choferId,
      password_hash,
      is_active: true,
      must_change_password: true
    }], { session });

    await session.commitTransaction();
    session.endSession();
    return res.status(201).json({
      ok: true,
      chofer: { _id: choferId, nombre, telefono },
      user:   { _id: user._id, username: user.username, role: user.role }
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    // Manejo elegante de duplicados
    if (err && err.code === 11000) {
      // intenta identificar el campo duplicado
      const campo = Object.keys(err.keyPattern || {})[0] || 'campo único';
      return res.status(409).json({ ok:false, error:`Duplicado en ${campo}` });
    }
    console.error('crearChofer error:', err);
    return res.status(500).json({ ok:false, error: 'Error al crear chofer', detail: err.message });
  }
};

/* ====== Panel choferes (asignados / asignar por QR) — como ya te pasé ====== */
exports.asignadosDelDia = async (req, res, next) => {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);
    const filtro = { estado: 'asignado', fecha: { $gte: hoy, $lt: man } };
    if (req.query.chofer_id) filtro.chofer_id = req.query.chofer_id;
    const envios = await Envio.find(filtro).lean();
    res.json({ total: envios.length, envios });
  } catch (e) { next(e); }
};

exports.asignarPorQR = async (req, res, next) => {
  try {
    const { tracking, id_venta, chofer_id, chofer_nombre, actor_name } = req.body || {};
    const key = String(id_venta || tracking || '').trim();
    if (!key) return res.status(400).json({ error: 'Falta tracking o id_venta' });

    let envio = await Envio.findOne({ id_venta: key }) || await Envio.findOne({ meli_id: key });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const update = {
      $set: { estado: 'asignado' },
      $push: { historial: { at: new Date(), estado: 'asignado', source: 'zupply:qr', actor_name: actor_name || chofer_nombre || 'operador' } }
    };
    if (chofer_id) update.$set.chofer_id = chofer_id;
    if (chofer_nombre) update.$set.chofer_nombre = chofer_nombre;

    const updated = await Envio.findByIdAndUpdate(envio._id, update, { new: true });
    res.json({ ok: true, envio: updated });
  } catch (e) { next(e); }
};

exports.asignarDesdeMapa = async (_req, res) => res.status(501).json({ error: 'No implementado aún' });
