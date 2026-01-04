// scripts/sync-partidos-zonas.js
const mongoose = require('mongoose');

// Connection strings desde variables de entorno
const PROD_URI = process.env.PROD_MONGODB_URI;
const STAGING_URI = process.env.MONGODB_URI;

async function syncCollections() {
  // Validar que existan las variables de entorno
  if (!PROD_URI) {
    console.error('❌ Error: PROD_MONGODB_URI no está configurada');
    console.log('💡 Agregar en Render → Environment: PROD_MONGODB_URI=mongodb+srv://...');
    process.exit(1);
  }
  
  if (!STAGING_URI) {
    console.error('❌ Error: MONGODB_URI no está configurada');
    process.exit(1);
  }

  try {
    console.log('🔄 Conectando a producción...');
    const prodConn = mongoose.createConnection(PROD_URI);
    
    console.log('🔄 Conectando a staging...');
    const stagingConn = mongoose.createConnection(STAGING_URI);
    
    await Promise.all([
      prodConn.asPromise(),
      stagingConn.asPromise()
    ]);
    
    console.log('✅ Conexiones establecidas\n');
    
    // Schema genérico para cualquier colección
    const genericSchema = new mongoose.Schema({}, { strict: false });
    
    // ----- PARTIDOS -----
    console.log('📋 Copiando partidos...');
    const PartidosProd = prodConn.model('Partido', genericSchema, 'partidos');
    const PartidosStaging = stagingConn.model('Partido', genericSchema, 'partidos');
    
    const partidos = await PartidosProd.find({}).lean();
    console.log(`   Encontrados: ${partidos.length} partidos en producción`);
    
    if (partidos.length > 0) {
      await PartidosStaging.deleteMany({});
      await PartidosStaging.insertMany(partidos);
      console.log(`   ✅ ${partidos.length} partidos copiados\n`);
    } else {
      console.log('   ⚠️  No hay partidos en producción\n');
    }
    
    // ----- ZONAS -----
    console.log('📋 Copiando zonas...');
    const ZonasProd = prodConn.model('Zona', genericSchema, 'zonas');
    const ZonasStaging = stagingConn.model('Zona', genericSchema, 'zonas');
    
    const zonas = await ZonasProd.find({}).lean();
    console.log(`   Encontrados: ${zonas.length} zonas en producción`);
    
    if (zonas.length > 0) {
      await ZonasStaging.deleteMany({});
      await ZonasStaging.insertMany(zonas);
      console.log(`   ✅ ${zonas.length} zonas copiadas\n`);
    } else {
      console.log('   ⚠️  No hay zonas en producción\n');
    }
    
    await prodConn.close();
    await stagingConn.close();
    
    console.log('🎉 Sincronización completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error durante la sincronización:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar
syncCollections();
