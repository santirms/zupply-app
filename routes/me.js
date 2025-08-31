const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth');

router.get('/', requireAuth, (req, res) => {
  const { email, role, driver_id } = req.session.user;
  res.json({ email, role, driver_id });
});

module.exports = router;
