// scripts/fix-user-indexes.js
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // 1) listar actuales
    const before = await User.collection.indexes();
    console.log('Índices ANTES:', before);

    // 2) dropear los viejos si existen
    const dropIf = async (name) => {
      try { await User.collection.dropIndex(name); console.log('Drop idx', name); }
      catch (e) { if (e.codeName !== 'IndexNotFound') console.warn('No drop', name, e.codeName||e.message); }
    };
    await dropIf('email_1');
    await dropIf('username_1');
    await dropIf('driver_id_1');

    // 3) crear nuevos compatibles
    await User.collection.createIndex(
      { email: 1 },
      { name: 'email_unique_exists', unique: true, partialFilterExpression: { email: { $exists: true } } }
    );
    await User.collection.createIndex(
      { username: 1 },
      { name: 'username_unique_exists', unique: true, partialFilterExpression: { username: { $exists: true } } }
    );
    await User.collection.createIndex(
      { driver_id: 1 },
      { name: 'driver_unique_exists', unique: true, partialFilterExpression: { driver_id: { $exists: true } } }
    );

    // 4) mostrar resultado
    const after = await User.collection.indexes();
    console.log('Índices DESPUÉS:', after);
    process.exit(0);
  } catch (e) {
    console.error('fix-user-indexes error:', e);
    process.exit(1);
  }
})();
