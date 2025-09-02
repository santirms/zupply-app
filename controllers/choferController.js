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
  const { nombre, telefono } = req.body || {};
  if (!nombre || !telefono) return res.status(400).json({ msg: 'Faltan nombre o teléfono' });

  try {
    // 1) Crear Chofer
    const nuevo = new Chofer({ nombre, telefono });
    await nuevo.save();

    // 2) Generar username único a partir del nombre
    const base = slugify(nombre);
    let username = base;
    let i = 1;
    while (await User.findOne({ username })) {
      username = `${base}${++i}`;
    }

    // 3) Crear usuario "chofer", password = teléfono (hasheado)
    const password_hash = await bcrypt.hash(String(telefono), 12);
    await User.create({
      username,
      phone: String(telefono),
      role: 'chofer',
      password_hash,
      driver_id: nuevo._id,
      is_active: true,
      must_change_password: true // opcional: forzar cambio en primer login
    });

    res.status(201).json({ chofer: nuevo, user: { username, role: 'chofer' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Error al crear chofer' });
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
