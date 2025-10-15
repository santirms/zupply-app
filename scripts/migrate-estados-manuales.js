require('dotenv').config();
const mongoose = require('mongoose');
const Envio = require('../models/Envio');

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Conectado a MongoDB');

    const result = await Envio.updateMany(
      { requiere_sync_meli: { $exists: false } },
      {
        $set: {
          requiere_sync_meli: true,
          origen: 'mercadolibre'
        }
      }
    );

    console.log(`✓ ${result.modifiedCount} envíos actualizados con requiere_sync_meli=true`);

    const manuales = await Envio.updateMany(
      {
        meli_id: { $exists: false },
        sender_id: { $exists: false },
        requiere_sync_meli: true
      },
      {
        $set: {
          requiere_sync_meli: false,
          origen: 'ingreso_manual'
        }
      }
    );

    console.log(`✓ ${manuales.modifiedCount} envíos detectados como manuales`);

    await mongoose.disconnect();
    console.log('✓ Migración completada exitosamente');
  } catch (err) {
    console.error('❌ Error en migración:', err);
    process.exit(1);
  }
}

migrate();
