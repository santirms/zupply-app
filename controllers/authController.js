// controllers/authController.js
const bcrypt = require('bcryptjs');
const User   = require('../models/User');

async function login(req, res, next) {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: 'Faltan credenciales' });

    const id = String(identifier).trim().toLowerCase();
    const isEmail = id.includes('@');

    const query = isEmail
      ? { email: id }
      : { $or: [ { username: id }, { phone: identifier }, { phone: identifier.replace(/\D/g,'') } ] };

    // OJO: password_hash tiene select:false en el schema
    const user = await User.findOne(query)
      .select('+password_hash +role +driver_id +is_active +email +username');

    if (!user) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });
    if (!user.is_active) return res.status(403).json({ error: 'Usuario inactivo' });

    const ok = await bcrypt.compare(String(password), user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña inválidos' });

    req.session.user = {
        _id: user._id,
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
  const u = req.session?.user;
  if (!u?.authenticated) return res.status(401).json({ error: 'No autenticado' });

  console.log('=== GET /me ===');
  console.log('Usuario en sesión:', u);

  // Construir respuesta base
  const respuesta = {
    ok: true,
    _id: u._id,
    email: u.email,
    username: u.username,
    role: u.role,
    driver_id: u.driver_id || null,
    cliente_id: u.cliente_id || null,
    sender_ids: u.sender_ids || []
  };

  // Si es cliente, buscar información del cliente y permisos
  if (u.cliente_id) {
    try {
      console.log('Es cliente, buscando info del cliente:', u.cliente_id);

      const Cliente = require('../models/Cliente');
      const cliente = await Cliente.findById(u.cliente_id)
        .select('nombre razon_social codigo_cliente permisos')
        .lean();

      console.log('Cliente encontrado:', cliente);

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

        console.log('Permisos del cliente:', respuesta.permisos);
      }
    } catch (err) {
      console.error('Error obteniendo información del cliente:', err);
    }
  }

  // Si es chofer, incluir información del driver
  if (u.driver_id) {
    respuesta.driver = {
      _id: u.driver_id
    };
  }

  console.log('Respuesta final /me:', respuesta);

  res.json(respuesta);
}

module.exports = { login, logout, me };
