// controllers/choferController.js
const Envio  = require('../models/Envio');
const Chofer = require('../models/Chofer');

/* ===================== Choferes (ya los tenías) ===================== */
exports.listarChoferes = async (req, res) => {
  try {
    const choferes = await Chofer.find().sort('nombre');
    res.json(choferes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Error al listar choferes' });
  }
};

exports.crearChofer = async (req, res) => {
  const { nombre, telefono } = req.body;
  if (!nombre || !telefono) {
    return res.status(400).json({ msg: 'Faltan nombre o teléfono' });
  }
  try {
    const nuevo = new Chofer({ nombre, telefono });
    await nuevo.save();
    res.status(201).json(nuevo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Error al crear chofer' });
  }
};

/* ===================== NUEVO: Panel choferes ===================== */

/**
 * GET /api/choferes/asignados
 * Lista envíos en estado "asignado" del día. Si pasás ?chofer_id= filtra por chofer.
 * Usa el campo "fecha" (ajústalo si usás otro).
 */
exports.asignadosDelDia = async (req, res, next) => {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);

    const filtro = {
      estado: 'asignado',
      fecha: { $gte: hoy, $lt: man },
    };
    if (req.query.chofer_id) filtro.chofer_id = req.query.chofer_id;

    const envios = await Envio.find(filtro).lean();
    res.json({ total: envios.length, envios });
  } catch (e) { next(e); }
};

/**
 * POST /api/choferes/asignar-por-qr
 * body: { tracking? | id_venta?, chofer_id?, chofer_nombre?, actor_name? }
 * Busca por id_venta (o tracking/meli_id como fallback) y marca "asignado".
 */
exports.asignarPorQR = async (req, res, next) => {
  try {
    const { tracking, id_venta, chofer_id, chofer_nombre, actor_name } = req.body || {};
    const key = String(id_venta || tracking || '').trim();
    if (!key) return res.status(400).json({ error: 'Falta tracking o id_venta' });

    // Ajustá estos campos a tu esquema real
    let envio =
      await Envio.findOne({ id_venta: key }) ||
      await Envio.findOne({ meli_id: key });

    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const update = {
      $set: { estado: 'asignado' },
      $push: {
        historial: {
          at: new Date(),
          estado: 'asignado',
          estado_meli: null,
          source: 'zupply:qr',
          actor_name: actor_name || chofer_nombre || 'operador'
        }
      }
    };

    // Si tu schema guarda chofer_id / chofer_nombre directamente:
    if (chofer_id)     update.$set.chofer_id     = chofer_id;
    if (chofer_nombre) update.$set.chofer_nombre = chofer_nombre;

    // Si tu schema usa un subdocumento `chofer` como { _id, nombre }, podrías hacer:
    // if (chofer_id || chofer_nombre) update.$set.chofer = { _id: chofer_id || undefined, nombre: chofer_nombre || undefined };

    const updated = await Envio.findByIdAndUpdate(envio._id, update, { new: true });
    res.json({ ok: true, envio: updated });
  } catch (e) { next(e); }
};

/**
 * POST /api/choferes/asignar-desde-mapa
 * Aún no implementado: dejalo como 501 para no romper rutas.
 */
exports.asignarDesdeMapa = async (_req, res) => {
  res.status(501).json({ error: 'No implementado aún' });
};
