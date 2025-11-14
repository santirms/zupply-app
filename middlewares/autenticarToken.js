// middlewares/autenticarToken.js
// Este middleware verifica la sesión del usuario
// Nota: A pesar del nombre, el sistema usa sesiones (cookies), no tokens JWT

function autenticarToken(req, res, next) {
  const u = req.session?.user;

  if (!u?.authenticated) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  // Establecer req.user para compatibilidad
  req.user = {
    _id: u._id,
    email: u.email,
    username: u.username,
    role: u.role,
    driver_id: u.driver_id || null,
    cliente_id: u.cliente_id || null,
    sender_ids: u.sender_ids || [],
    authenticated: true
  };

  next();
}

module.exports = autenticarToken;
