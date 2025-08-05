// backend/controllers/listasDePreciosController.js
const ListaDePrecios = require('../models/ListaDePrecios');

exports.listarListas = async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    console.log('[listarListas] prefix=', prefix);

    // Si recibimos un prefijo, filtramos; si no, devolvemos todo.
    const filter = prefix
      ? { nombre: { $regex: `^${prefix}`, $options: 'i' } }
      : {};

    const listas = await ListaDePrecios.find(filter);
    console.log(`[listarListas] encontradas ${listas.length} listas`);

    return res.json(listas);
  } catch (err) {
    console.error('[listarListas] ERROR', err);
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
    console.error('[crearLista] ERROR', err);
    return res.status(500).json({ msg: 'Error creando lista' });
  }
};
