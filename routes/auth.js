// routes/auth.js
const path = require('path');
const express = require('express');
const router = express.Router();

const USERS = {
  admin:     { password: 'techoro01', role: 'admin' },
  logistica: { password: '123',       role: 'coordinator' }
};

// Login page (html simple)
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// Estado de sesión actual
router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(200).json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

// Login (POST desde el form)
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS[username];
  if (!user || user.password !== password) {
    return res.status(401).send('Usuario o contraseña inválidos');
  }
  req.session.user = { username, role: user.role };
  res.redirect('/'); // mandalo al home
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
