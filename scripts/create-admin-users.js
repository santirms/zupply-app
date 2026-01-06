// scripts/create-admin-users.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
require('dotenv').config();

async function createAdminUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado a MongoDB\n');

    // Tenant Demo
    const demoTenant = await Tenant.findOne({ subdomain: 'demo' });
    if (demoTenant) {
      const existingDemoUser = await User.findOne({ 
        email: 'admin@demo.zupply.tech',
        tenantId: demoTenant._id 
      });

      if (existingDemoUser) {
        console.log('ℹ️  Usuario admin de DEMO ya existe');
      } else {
        const hashedPassword = await bcrypt.hash('Demo123!', 10);
        await User.create({
          email: 'admin@demo.zupply.tech',
          password: hashedPassword,
          role: 'admin',
          tenantId: demoTenant._id
        });
        console.log('✅ Usuario admin DEMO creado');
        console.log('   Email: admin@demo.zupply.tech');
        console.log('   Password: Demo123!');
        console.log('   URL: https://demo.zupply.tech\n');
      }
    } else {
      console.log('❌ Tenant demo no encontrado\n');
    }

    // Tenant Test
    const testTenant = await Tenant.findOne({ subdomain: 'test' });
    if (testTenant) {
      const existingTestUser = await User.findOne({ 
        email: 'admin@test.zupply.tech',
        tenantId: testTenant._id 
      });

      if (existingTestUser) {
        console.log('ℹ️  Usuario admin de TEST ya existe');
      } else {
        const hashedPassword = await bcrypt.hash('Test123!', 10);
        await User.create({
          email: 'admin@test.zupply.tech',
          password: hashedPassword,
          role: 'admin',
          tenantId: testTenant._id
        });
        console.log('✅ Usuario admin TEST creado');
        console.log('   Email: admin@test.zupply.tech');
        console.log('   Password: Test123!');
        console.log('   URL: https://test.zupply.tech\n');
      }
    } else {
      console.log('❌ Tenant test no encontrado\n');
    }

    console.log('⚠️  IMPORTANTE: Cambiar estas contraseñas después del primer login\n');
    
    await mongoose.disconnect();
    console.log('✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createAdminUsers();
