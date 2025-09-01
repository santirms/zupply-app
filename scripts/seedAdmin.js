// scripts/seedAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || process.argv[2] || '').toLowerCase();
  const pass  = process.env.SEED_ADMIN_PASS || process.argv[3];

  if (!email || !pass) {
    console.error('Uso: node scripts/seedAdmin.js <email> <password>');
    console.error('   ó  SEED_ADMIN_EMAIL=... SEED_ADMIN_PASS=... node scripts/seedAdmin.js');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const exists = await User.findOne({ email });
  if (exists) {
    console.log('Ya existe un usuario con ese email. Nada que hacer.');
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(pass, 12);
  await User.create({ email, role: 'admin', password_hash, is_active: true });
  console.log('✅ Admin creado:', email);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
