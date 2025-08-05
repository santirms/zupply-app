// controllers/choferController.js
const Chofer = require('../models/Chofer');

// GET /api/choferes
exports.listarChoferes = async (req, res) => {
  try {
    const choferes = await Chofer.find().sort('nombre');
    res.json(choferes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Error al listar choferes' });
  }
};

// POST /api/choferes
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
