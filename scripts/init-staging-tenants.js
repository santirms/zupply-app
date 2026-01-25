// scripts/init-staging-tenants.js
require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');

async function initStagingTenants() {
  try {
    // Conectar a MongoDB
    console.log('Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    // Verificar/Crear tenant 'demo'
    console.log('\n--- Verificando tenant "demo" ---');
    let demoTenant = await Tenant.findOne({ subdomain: 'demo' });

    if (!demoTenant) {
      console.log('Creando tenant "demo"...');
      demoTenant = await Tenant.create({
        companyName: 'Zupply Demo',
        subdomain: 'demo',
        isActive: true,
        plan: 'pro',
        settings: {
          brandColor: '#FF6B35',
          companyInfo: {
            email: 'demo@zupply.tech'
          }
        }
      });
      console.log('✅ Tenant "demo" creado exitosamente');
    } else {
      console.log('ℹ️  Tenant "demo" ya existe');
    }

    // Verificar/Crear tenant 'test'
    console.log('\n--- Verificando tenant "test" ---');
    let testTenant = await Tenant.findOne({ subdomain: 'test' });

    if (!testTenant) {
      console.log('Creando tenant "test"...');
      testTenant = await Tenant.create({
        companyName: 'Logística Test',
        subdomain: 'test',
        isActive: true,
        plan: 'basic',
        settings: {
          brandColor: '#4A90E2',
          companyInfo: {
            email: 'test@zupply.tech'
          }
        }
      });
      console.log('✅ Tenant "test" creado exitosamente');
    } else {
      console.log('ℹ️  Tenant "test" ya existe');
    }

    // Mostrar total de tenants
    const totalTenants = await Tenant.countDocuments();
    console.log(`\n📊 Total de tenants en la base de datos: ${totalTenants}`);

    // Cerrar conexión
    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
    console.log('Script finalizado exitosamente');

  } catch (error) {
    console.error('❌ Error durante la inicialización:', error);
    await mongoose.disconnect();
    throw error;
  }
}

// Ejecutar la función
initStagingTenants().catch(console.error);
