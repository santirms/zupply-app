const Envio = require('../models/Envio');
const logger = require('../utils/logger');

const ESTADOS_CHOFER = ['entregado', 'comprador_ausente', 'rechazado', 'inaccesible'];

function obtenerChoferId(req) {
  // Intentar múltiples campos posibles
  const fromReq = req.user?.driver_id ||
                  req.user?._id ||
                  req.user?.id ||
                  req.session?.user?.driver_id ||
                  req.session?.user?._id ||
                  req.session?.user?.id ||
                  null;

  if (!fromReq) {
    console.log('[obtenerChoferId] No se encontró ID. req.user:', req.user);
    return null;
  }

  return String(fromReq);
}

function esEnvioManual(envio) {
  const meliId = envio?.meli_id;
  return !meliId || String(meliId).trim() === '';
}

function obtenerIdChoferDelEnvio(envio) {
  // Intentar múltiples campos (compatibilidad con legacy)
  const chofer = envio?.chofer ?? 
                 envio?.chofer_id ?? 
                 envio?.driver_id ?? 
                 null;
  
  if (!chofer) return null;
  
  // Si es ObjectId poblado
  if (typeof chofer === 'object' && chofer._id) {
    return String(chofer._id);
  }
  
  // Si es string o ObjectId directo
  return String(chofer);
}

function obtenerNombreUsuario(user = {}) {
  return user.nombre || user.username || user.email || 'chofer';
}

exports.misDelDia = async (req, res, next) => {
  try {
    const { driver_id } = req.session.user;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const mañana = new Date(hoy); mañana.setDate(hoy.getDate() + 1);

    const envios = await Envio.find({
      chofer_id: driver_id,
      createdAt: { $gte: hoy, $lt: mañana } // ajustá al campo fecha que uses
    }).lean();

    res.json({ envios });
  } catch (e) { next(e); }
};

exports.marcarEntregado = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Envio.findByIdAndUpdate(id, {
      estado: 'entregado',
      $push: { historial: { at: new Date(), estado: 'entregado', source: 'panel', actor_name: 'chofer' } }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

exports.marcarEstado = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, notas } = req.body || {};

    if (!ESTADOS_CHOFER.includes(estado)) {
      return res.status(400).json({
        error: 'Estado no válido',
        permitidos: ESTADOS_CHOFER
      });
    }

    const choferId = obtenerChoferId(req);
    if (!choferId) {
      return res.status(403).json({ error: 'Perfil chofer no vinculado' });
    }

    const envio = await Envio.findById(id).select(
      'estado historial_estados historial tracking id_venta meli_id chofer chofer_id requiere_sync_meli'
    );

    if (!envio) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envioChoferId = obtenerIdChoferDelEnvio(envio);
    if (!envioChoferId || envioChoferId !== choferId) {
      return res.status(403).json({ error: 'Este envío no está asignado a ti' });
    }

    if (!esEnvioManual(envio) || envio.requiere_sync_meli === true) {
      return res.status(400).json({ error: 'No puedes modificar envíos de MercadoLibre' });
    }

    const estadoAnterior = envio.estado;

    const vuelveAPlanta = estado === 'comprador_ausente' || estado === 'rechazado';

    if (vuelveAPlanta) {
      envio.estado = 'en_planta';
      envio.chofer = null;

      logger.info('[Chofer] Envío vuelve a planta', {
        tracking: envio.tracking || envio.id_venta,
        motivo: estado,
        chofer_anterior: obtenerNombreUsuario(req.user)
      });
    } else {
      envio.estado = estado;
    }

    if (!Array.isArray(envio.historial_estados)) {
      envio.historial_estados = [];
    }

    const notasTrimmed = notas ? String(notas).trim() : '';

    envio.historial_estados.unshift({
      estado,
      fecha: new Date(),
      usuario: obtenerNombreUsuario(req.user),
      notas: notasTrimmed || null
    });

    if (Array.isArray(envio.historial)) {
      const actor = obtenerNombreUsuario(req.user);
      envio.historial.unshift({
        at: new Date(),
        estado,
        source: 'chofer-app',
        actor_name: actor,
        note: notasTrimmed || `Marcado como ${estado.replace(/_/g, ' ')}`
      });

      if (vuelveAPlanta) {
        envio.historial.unshift({
          at: new Date(),
          estado: 'en_planta',
          source: 'auto',
          actor_name: 'Sistema',
          note: `Vuelve a planta por: ${estado.replace(/_/g, ' ')}`
        });
      }
    }

    if (notasTrimmed) {
      const usuarioNota = obtenerNombreUsuario(req.user);
      const estadoFormateado = estado.replace(/_/g, ' ').toUpperCase();
      const textoNota = `[${estadoFormateado}] ${notasTrimmed}`;

      if (!Array.isArray(envio.notas)) {
        envio.notas = [];
      }

      envio.notas.push({
        texto: textoNota,
        usuario: usuarioNota,
        fecha: new Date(),
        tipo: 'chofer',
        actor_name: usuarioNota,
        actor_role: 'chofer'
      });

      logger.info('[Chofer] Nota agregada', {
        id_venta: envio.id_venta,
        chofer: usuarioNota,
        estado,
        nota_length: notasTrimmed.length
      });
    }

    await envio.save();

    logger.info('[Chofer] Estado marcado', {
      tracking: envio.tracking || envio.id_venta,
      chofer: obtenerNombreUsuario(req.user),
      estado_marcado: estado,
      estado_anterior: estadoAnterior,
      estado_final: envio.estado
    });

    const mensaje = vuelveAPlanta
      ? `Envío marcado como ${estado.replace(/_/g, ' ')}. Vuelve a planta para reasignación.`
      : `Envío marcado como ${estado.replace(/_/g, ' ')}`;

    res.json({
      success: true,
      estado_marcado: estado,
      estado_actual: envio.estado,
      mensaje
    });
  } catch (err) {
    logger.error('[Chofer] Error marcando estado:', err);
    res.status(500).json({ error: 'Error actualizando estado' });
  }
};

exports.getEnviosActivos = async (req, res) => {
  try {
    const choferId = obtenerChoferId(req);
    
    logger.info('[Mis Envios] Request de chofer', {
      choferId,
      userId: req.user?._id
    });
    
    if (!choferId) {
      return res.status(400).json({ 
        error: 'No se pudo identificar al chofer' 
      });
    }
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    // Query con campos REALES del modelo
const query = {
  // Compatibilidad con múltiples campos de chofer
  $or: [
    { chofer: choferId },
    { chofer_id: choferId },
    { driver_id: choferId }
  ],
  fecha: { $gte: hoy },
  meli_id: { $in: [null, ''] },
  estado: { 
    $nin: ['entregado', 'cancelado', 'devolucion'] 
  }
};
    
    logger.debug('[Mis Envios] Query', { 
      chofer: choferId, 
      fecha_desde: hoy 
    });
    
    const envios = await Envio.find(query)
      .populate('cliente_id', 'nombre razon_social telefono')
      .populate('chofer', 'nombre email')
      .select('id_venta destinatario direccion partido codigo_postal estado fecha referencia precio')
      .sort({ fecha: -1 })
      .lean();
    
    logger.info('[Mis Envios] Resultado', {
      choferId,
      cantidad: envios.length
    });
    
    res.json(envios);
    
  } catch (err) {
    logger.error('[Mis Envios] Error', { 
      error: err.message, 
      stack: err.stack 
    });
    
    res.status(500).json({ 
      error: 'Error obteniendo envíos' 
    });
  }
};
