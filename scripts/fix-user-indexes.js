// scripts/fix-user-indexes.js
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    try { await User.collection.dropIndex('email_1'); } 
    catch (e) { if (e.codeName !== 'IndexNotFound') console.error(e); }

    try { await User.collection.dropIndex('username_1'); } 
    catch (e) { if (e.codeName !== 'IndexNotFound') console.error(e); }

    // recrea según tu schema (asegurate de tener los índices parciales en el schema)
    await User.syncIndexes();

    console.log('Índices actuales:', await User.collection.indexes());
    process.exit(0);
  } catch (e) {
    console.error('fix-user-indexes error:', e);
    process.exit(1);
  }
})();
