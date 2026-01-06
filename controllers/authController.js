// controllers/authController.js
const bcrypt = require('bcryptjs');
const User   = require('../models/User');

async function login(req, res, next) {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: 'Faltan credenciales' });

    const id = String(identifier).trim().toLowerCase();
    const isEmail = id.includes('@');

    // Filtrar por tenant Y el identificador del usuario
    const baseQuery = isEmail
      ? { email: id }
      : { $or: [ { username: id }, { phone: identifier }, { phone: identifier.replace(/\D/g,'') } ] };

    // IMPORTANTE: agregar tenantId para asegurar que el usuario solo puede loguearse en SU tenant
    const query = { ...baseQuery, tenantId: req.tenantId };

    // OJO: password_hash tiene select:false en el schema
    const user = await User.findOne(query)
      .select('+password_hash +role +driver_id +is_active +email +username');

    if (!user) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' });

    const ok = await bcrypt.compare(String(password), user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });

    req.session.user = {
        _id: user._id,
        tenantId: user.tenantId, // Multi-tenancy: guardar tenantId en sesión
        email: user.email,
        username: user.username,
        role: user.role,
        driver_id: user.driver_id || null,
        sender_ids: Array.isArray(user.sender_ids) ? user.sender_ids.map(String) : [], // ⬅️ importante
        cliente_id: user.cliente_id || null,
        authenticated: true
    };

    user.last_login = new Date();
    await user.save();

    // al final del login, antes de responder:
    const map = { chofer: '/mis-envios.html', coordinador: '/index.html', admin: '/index.html', cliente: '/client-panel.html' };
    return res.json({ ok: true, role: user.role, redirectTo: map[user.role] || '/index.html' });
    } catch (e) { next(e); }
}

async function logout(req, res) {
  req.session.destroy?.(()=>{});
  res.json({ ok: true });
}

async function me(req, res) {
  try {
    console.log('=== GET /api/auth/me ===');
    console.log('Usuario ID:', req.user._id);
    console.log('TenantId:', req.user.tenantId);

    // Buscar usuario en DB para obtener información actualizada
    // IMPORTANTE: Filtrar por _id Y tenantId para seguridad multi-tenant
    const usuario = await User.findOne({ _id: req.user._id, tenantId: req.user.tenantId })
      .select('-password_hash')
      .lean();

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    console.log('Usuario encontrado:', usuario.email);
    console.log('Cliente_id:', usuario.cliente_id);

    // Construir respuesta base
    const respuesta = {
      _id: usuario._id,
      email: usuario.email,
      username: usuario.username,
      role: usuario.role,
      driver_id: usuario.driver_id || null,
      cliente_id: usuario.cliente_id || null
    };

    // Si tiene cliente_id, buscar información del cliente y permisos
    if (usuario.cliente_id) {
      console.log('Buscando cliente:', usuario.cliente_id);

      const Cliente = require('../models/Cliente');
      const cliente = await Cliente.findById(usuario.cliente_id)
        .select('nombre razon_social codigo_cliente permisos')
        .lean();

      console.log('Cliente encontrado:', cliente?.nombre);
      console.log('Permisos:', cliente?.permisos);

      if (cliente) {
        respuesta.cliente = {
          _id: cliente._id,
          nombre: cliente.nombre,
          razon_social: cliente.razon_social,
          codigo: cliente.codigo_cliente
        };

        // IMPORTANTE: Incluir permisos
        respuesta.permisos = cliente.permisos || {
          puedeRequerirFirma: false
        };
      }
    }

    console.log('Respuesta /me:', JSON.stringify(respuesta, null, 2));

    res.json(respuesta);

  } catch (error) {
    console.error('Error en GET /api/auth/me:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { login, logout, me };
