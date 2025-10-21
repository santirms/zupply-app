#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();
const Envio = require('../models/Envio');

async function limpiar() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ Error: variable de entorno MONGODB_URI no configurada');
    process.exit(1);
  }

  await mongoose.connect(uri);

  console.log('🧹 Limpiando substatus de envíos entregados...');

  const resultado1 = await Envio.updateMany(
    { estado: 'entregado' },
    {
      $set: {
        substatus: null,
        substatus_display: null
      }
    }
  );

  console.log(`✅ ${resultado1.modifiedCount} entregados limpiados`);

  const resultado2 = await Envio.updateMany(
    { estado: 'cancelado' },
    {
      $set: {
        substatus: null,
        substatus_display: null
      }
    }
  );

  console.log(`✅ ${resultado2.modifiedCount} cancelados limpiados`);

  const resultado3 = await Envio.updateMany(
    { estado_meli: { $exists: true } },
    {
      $unset: { estado_meli: '' }
    }
  );

  console.log(`✅ ${resultado3.modifiedCount} con campo estado_meli eliminado`);

  console.log('✅ Limpieza completada');
  process.exit(0);
}

limpiar().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
