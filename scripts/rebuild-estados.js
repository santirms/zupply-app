#!/usr/bin/env node

const mongoose = require('mongoose');
const Envio = require('../models/Envio');

async function rebuild() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  console.log('🔄 Rebuilding estados...');
  
  // Limpiar campos viejos
  await Envio.updateMany(
    {},
    { 
      $unset: { 
        substatus: '',
        substatus_display: '',
        estado_meli: ''
      }
    }
  );
  
  console.log('✅ Campos viejos eliminados');
  
  // Contar envíos activos
  const activos = await Envio.countDocuments({
    estado: { $in: ['pendiente', 'en_camino', 'en_planta', 'listo_retiro'] }
  });
  
  console.log(`📦 ${activos} envíos activos para actualizar`);
  console.log('');
  console.log('Ejecutar:');
  console.log('node scripts/hydrate-all-active.js');
  
  process.exit(0);
}

rebuild().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
