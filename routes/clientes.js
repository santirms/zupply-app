// routes/clientes.js
const express = require('express');
const router  = express.Router();
const Cliente = require('../models/Cliente');
const identifyTenant = require('../middlewares/identifyTenant');

// Aplicar middleware a todas las rutas
router.use(identifyTenant);

// GET todos
router.get('/', async (req, res) => {
  const clientes = await Cliente.find({ tenantId: req.tenantId }).populate('lista_precios');
  res.json(clientes);
});

// GET uno
router.get('/:id', async (req, res) => {
  try {
    const c = await Cliente.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('lista_precios');
    if (!c) return res.status(404).json({ error: 'No existe ese cliente' });
    res.json(c);
  } catch (e) {
    res.status(400).json({ error: 'ID inválido' });
  }
});

// PATCH /api/clientes/:id/auto-ingesta
router.patch('/:id/auto-ingesta', async (req, res) => {
  try {
    const { enabled } = req.body;
    const upd = await Cliente.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { auto_ingesta: !!enabled },
      { new: true }
    );
    if (!upd) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true, auto_ingesta: upd.auto_ingesta });
  } catch (e) {
    console.error('Error toggling auto_ingesta:', e);
    res.status(500).json({ error: 'No se pudo actualizar auto_ingesta' });
  }
});

// POST crear cliente
router.post('/', async (req, res) => {
  try {
    const sids = Array.isArray(req.body.sender_id)
      ? req.body.sender_id.filter(v => !!v)
      : [];
    console.log('POST /clientes sender_id recibidos:', sids);

    const datos = {
      nombre:           req.body.nombre,
      sender_id:        sids,
      lista_precios:    req.body.lista_precios,
      cuit:             req.body.cuit,
      razon_social:     req.body.razon_social,
      condicion_iva:    req.body.condicion_iva,
      horario_de_corte: req.body.horario_de_corte,
      link_vinculacion: req.body.link_vinculacion,
      permisos:         req.body.permisos || {},
      facturacion:      req.body.facturacion || {},
      tenantId:         req.tenantId
    };

    const nuevo = new Cliente(datos);
    await nuevo.save();
    res.status(201).json(nuevo);

  } catch (err) {
    console.error('Error creando cliente:', err);
    const mensaje = err.code === 11000
      ? 'Dato duplicado'
      : err.message;
    res.status(400).json({ error: mensaje });
  }
});

// PUT actualizar cliente
router.put('/:id', async (req, res) => {
  try {
    const sids = Array.isArray(req.body.sender_id)
      ? req.body.sender_id.filter(v => !!v)
      : [];
    console.log('PUT /clientes sender_id recibidos:', sids);

    const datos = {
      nombre:           req.body.nombre,
      sender_id:        sids,
      lista_precios:    req.body.lista_precios,
      cuit:             req.body.cuit,
      razon_social:     req.body.razon_social,
      condicion_iva:    req.body.condicion_iva,
      horario_de_corte: req.body.horario_de_corte,
      link_vinculacion: req.body.link_vinculacion,
      permisos:         req.body.permisos || {},
      facturacion:      req.body.facturacion || {}
    };

    const upd = await Cliente.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      datos,
      { new: true, runValidators: true }
    );
    if (!upd) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(upd);
  } catch (err) {
    console.error('Error actualizando cliente:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET meli-link
router.get('/:id/meli-link', async (req, res) => {
  try {
    const { id }        = req.params;
    const { sender_id } = req.query;

    if (!sender_id) {
      return res.status(400).json({ error: 'Falta sender_id' });
    }

    const cliente = await Cliente.findOne({ _id: id, tenantId: req.tenantId });
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const stateRaw  = `${id}|${sender_id}`;
    const state     = encodeURIComponent(stateRaw);
    const redirect  = process.env.MERCADOLIBRE_REDIRECT_URI;

    console.log('ML LINK -> redirect_uri:', redirect);
    console.log('ML LINK -> state:', stateRaw);

    if (!redirect) {
      return res.status(500).json({ error: 'MERCADOLIBRE_REDIRECT_URI no seteado' });
    }

    const url =
      `https://auth.mercadolibre.com/authorization` +
      `?response_type=code` +
      `&client_id=${process.env.MERCADOLIBRE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&state=${state}`;

    return res.json({ url });
  } catch (e) {
    console.error('Error generando meli-link:', e);
    res.status(500).json({ error: 'No se pudo generar el link de vinculación' });
  }
});

// DELETE /:id - Eliminar cliente (solo admin)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Verificar que el cliente existe
    const cliente = await Cliente.findById(id);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    const Envio = require('../models/Envio');
    const Chofer = require('../models/Chofer');
    
    const hace10Dias = new Date();
    hace10Dias.setDate(hace10Dias.getDate() - 10);

    // 2. Verificar que no tenga envíos activos o recientes
    const enviosActivos = await Envio.countDocuments({ 
      cliente_id: id,
      $or: [
        // Envíos no finalizados
        { estado: { $nin: ['entregado', 'cancelado'] } },
        // Envíos finalizados hace menos de 10 días
        { 
          estado: { $in: ['entregado', 'cancelado'] },
          updatedAt: { $gte: hace10Dias }
        }
      ]
    });

    if (enviosActivos > 0) {
      return res.status(400).json({ 
        error: `No se puede eliminar el cliente porque tiene ${enviosActivos} envío${enviosActivos > 1 ? 's' : ''} activo${enviosActivos > 1 ? 's' : ''} o reciente${enviosActivos > 1 ? 's' : ''}. Esperá a que pasen 10 días desde el último envío.`
      });
    }

    // 3. Verificar que no tenga choferes asignados
    const choferesCount = await Chofer.countDocuments({ cliente_id: id });
    
    if (choferesCount > 0) {
      return res.status(400).json({ 
        error: `No se puede eliminar el cliente porque tiene ${choferesCount} chofer${choferesCount > 1 ? 'es' : ''} asignado${choferesCount > 1 ? 's' : ''}. Primero debe reasignar o eliminar los choferes.`
      });
    }

    // 4. Contar envíos viejos que se eliminarán
    const enviosViejos = await Envio.countDocuments({
      cliente_id: id,
      estado: { $in: ['entregado', 'cancelado'] },
      updatedAt: { $lt: hace10Dias }
    });

    // 5. Eliminar envíos viejos
    if (enviosViejos > 0) {
      const resultado = await Envio.deleteMany({
        cliente_id: id,
        estado: { $in: ['entregado', 'cancelado'] },
        updatedAt: { $lt: hace10Dias }
      });
      console.log(`🗑️ Eliminados ${resultado.deletedCount} envíos históricos del cliente ${cliente.nombre}`);
    }

    // 6. Eliminar cliente
    await Cliente.findByIdAndDelete(id);

    console.log(`✅ Cliente eliminado: ${cliente.nombre} (${id})`);

    return res.json({ 
      ok: true, 
      mensaje: 'Cliente eliminado exitosamente',
      cliente: {
        id: cliente._id,
        nombre: cliente.nombre
      },
      enviosEliminados: enviosViejos
    });

  } catch (err) {
    console.error('Error eliminando cliente:', err);
    return res.status(500).json({ error: 'Error al eliminar el cliente' });
  }
});

module.exports = router;
