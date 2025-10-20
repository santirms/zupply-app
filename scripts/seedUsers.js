require('../utils/logger');
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const passAdmin = await bcrypt.hash(process.env.SEED_ADMIN_PASS || 'admin123', 12);
  const passCoord = await bcrypt.hash(process.env.SEED_COORD_PASS || 'coord123', 12);
  const passChofer= await bcrypt.hash(process.env.SEED_CHOFER_PASS || 'chofer123', 12);

  await User.deleteMany({ email: { $in: ['admin@zupply.local','coord@zupply.local','chofer@zupply.local'] } });

  await User.create([
    { email: 'admin@zupply.local', role: 'admin', password_hash: passAdmin },
    { email: 'coord@zupply.local', role: 'coordinador', password_hash: passCoord },
    // reemplazá driver_id por un ObjectId real de tu chofer si tenés Driver model
    { email: 'chofer@zupply.local', role: 'chofer', password_hash: passChofer, driver_id: null }
  ]);

  console.log('Seed OK');
  process.exit(0);
})();
