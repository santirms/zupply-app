// backend/controllers/listasDePreciosController.js
const ListaDePrecios = require('../models/ListaDePrecios');
const logger = require('../utils/logger');

exports.listarListas = async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    logger.info('[listarListas] consulta', { prefix });

    // Si recibimos un prefijo, filtramos; si no, devolvemos todo.
    const filter = prefix
      ? { nombre: { $regex: `^${prefix}`, $options: 'i' } }
      : {};

    const listas = await ListaDePrecios.find(filter);
    logger.info('[listarListas] resultado', {
      prefix,
      total: listas.length
    });

    return res.json(listas);
  } catch (err) {
    logger.error('[listarListas] error', {
      error: err.message,
      stack: err.stack
    });
    return res.status(500).json({ msg: 'Error listando listas' });
  }
};

exports.crearLista = async (req, res) => {
  try {
    const { nombre, precio } = req.body;
    if (!nombre || precio == null) {
      return res.status(400).json({ msg: 'Faltan nombre o precio' });
    }
    const nueva = new ListaDePrecios({ nombre, precio });
    await nueva.save();
    return res.status(201).json(nueva);
  } catch (err) {
    logger.error('[crearLista] error', {
      error: err.message,
      stack: err.stack
    });
    return res.status(500).json({ msg: 'Error creando lista' });
  }
};
