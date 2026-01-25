// routes/listasDePrecios.js
const express = require('express');
const router  = express.Router();
const ListaDePrecios = require('../models/listaDePrecios');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar middleware a todas las rutas
router.use(identifyTenant);

// Crear nueva lista
router.post('/', async (req, res) => {
  try {
    console.log("Datos recibidos:", req.body);
    const nuevaLista = new ListaDePrecios({
      ...req.body,
      tenantId: req.tenantId
    });
    await nuevaLista.save();
    res.status(201).json(nuevaLista);
  } catch (err) {
    console.error("Error al crear lista:", err);
    res.status(500).json({ error: 'Error al guardar la lista de precios' });
  }
});

// Obtener (filtrando por prefijo si llega ?prefix=)
router.get('/', async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    
    // Filtrar por tenant y opcionalmente por prefijo de nombre
    const filter = { tenantId: req.tenantId };
    if (prefix) {
      filter.nombre = { $regex: `^${prefix}`, $options: 'i' };
    }
    
    const listas = await ListaDePrecios
      .find(filter)
      .populate('zonas.zona');
    
    console.log(`[listarListas] prefix="${prefix}", encontradas=${listas.length}`);
    res.json(listas);
  } catch (err) {
    console.error("[listarListas] ERROR", err);
    res.status(500).json({ error: err.message });
  }
});

// Modificar
router.put('/:id', async (req, res) => {
  try {
    const actualizada = await ListaDePrecios.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      req.body,
      { new: true }
    );
    
    if (!actualizada) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }
    
    res.json(actualizada);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar
router.delete('/:id', async (req, res) => {
  try {
    const eliminada = await ListaDePrecios.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId
    });
    
    if (!eliminada) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }
    
    res.json({ mensaje: 'Lista eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
