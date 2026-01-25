// scripts/migrate-production-transtech.js
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Tenant = require('../models/Tenant');
const Cliente = require('../models/Cliente');
const Envio = require('../models/Envio');
const Token = require('../models/Token');

// ========== CONFIGURACIÓN PARA TRANSTECH ==========
const TENANT_CONFIG = {
  subdomain: 'transtech',
  companyName: 'Transtech',
  plan: 'pro'
};
// ==================================================

// Helper para refrescar token si está vencido
async function refreshTokenIfNeeded(tokenDoc) {
  const expiryMs = (tokenDoc.expires_in || 0) * 1000;
  const createdAt = new Date(tokenDoc.fecha_creacion || 0);
  const expiresAt = createdAt.getTime() + expiryMs;
  const isExpired = Date.now() >= expiresAt - 60000; // 1 min de buffer

  if (!isExpired) {
    console.log('✅ Token todavía válido');
    return tokenDoc;
  }

  console.log('⚠️  Token expirado, refrescando...');
  
  if (!tokenDoc.refresh_token) {
    throw new Error('No hay refresh_token disponible. Necesitás reconectar OAuth manualmente.');
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.MERCADOLIBRE_CLIENT_ID,
      client_secret: process.env.MERCADOLIBRE_CLIENT_SECRET,
      refresh_token: tokenDoc.refresh_token
    });

    const { data } = await axios.post(
      'https://api.mercadolibre.com/oauth/token',
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('✅ Token refrescado exitosamente');

    // Actualizar en BD
    tokenDoc.access_token = data.access_token;
    tokenDoc.refresh_token = data.refresh_token || tokenDoc.refresh_token;
    tokenDoc.expires_in = data.expires_in;
    tokenDoc.fecha_creacion = new Date();
    await tokenDoc.save();

    return tokenDoc;
  } catch (err) {
    console.error('❌ Error refrescando token:', err.response?.data || err.message);
    throw new Error('No se pudo refrescar el token. Necesitás reconectar OAuth manualmente.');
  }
}

// Helper para obtener nickname
async function getNickname(accessToken) {
  try {
    const { data } = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return data.nickname || null;
  } catch {
    return null;
  }
}

async function migrateToMultiTenant() {
  try {
    console.log('========================================');
    console.log('   MIGRACIÓN A MULTI-TENANT');
    console.log('   Tenant: ' + TENANT_CONFIG.companyName);
    console.log('   Subdomain: ' + TENANT_CONFIG.subdomain);
    console.log('========================================\n');

    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Conectado a MongoDB\n');

    // 1. VERIFICAR SI YA EXISTE EL TENANT
    let tenant = await Tenant.findOne({ subdomain: TENANT_CONFIG.subdomain });
    
    if (tenant) {
      console.log('⚠️  El tenant ya existe!');
      console.log('   ID:', tenant._id.toString());
      console.log('   ¿Continuar con la migración de datos? (esto es seguro)\n');
    } else {
      console.log('📝 Creando tenant ' + TENANT_CONFIG.companyName + '...');
      tenant = new Tenant({
        companyName: TENANT_CONFIG.companyName,
        subdomain: TENANT_CONFIG.subdomain,
        isActive: true,
        plan: TENANT_CONFIG.plan,
        settings: {
          brandColor: '#FF6B35',
          companyInfo: {}
        },
        config: {
          autoIngesta: true
        }
      });
      await tenant.save();
      console.log('✅ Tenant creado:', tenant._id.toString(), '\n');
    }

    // 2. MIGRAR TOKEN DE ML AL TENANT
    if (!tenant.mlIntegration?.accessToken || !tenant.mlIntegration?.connected) {
      console.log('📝 Buscando credenciales de ML en colección Token...');
      
      const existingToken = await Token.findOne({}).sort({ fecha_creacion: -1 });
      
      if (!existingToken) {
        console.log('⚠️  No hay tokens en la BD.');
        console.log('   Necesitarás conectar ML manualmente después del deploy.\n');
      } else if (!existingToken.access_token || !existingToken.user_id) {
        console.log('⚠️  Token incompleto en BD.');
        console.log('   Campos encontrados:', {
          user_id: !!existingToken.user_id,
          access_token: !!existingToken.access_token,
          refresh_token: !!existingToken.refresh_token
        });
        console.log('   Necesitarás reconectar ML manualmente.\n');
      } else {
        console.log('✅ Token encontrado para user_id:', existingToken.user_id);
        
        try {
          // Intentar refrescar si está vencido
          const freshToken = await refreshTokenIfNeeded(existingToken);
          
          // Obtener nickname
          const nickname = await getNickname(freshToken.access_token);
          
          // Guardar en tenant
          tenant.mlIntegration = {
            userId: freshToken.user_id,
            accessToken: freshToken.access_token,
            refreshToken: freshToken.refresh_token,
            nickname: nickname,
            expiresIn: freshToken.expires_in,
            tokenUpdatedAt: new Date(),
            connectedAt: freshToken.fecha_creacion || new Date(),
            connected: true
          };
          await tenant.save();
          
          console.log('✅ Credenciales ML migradas al tenant');
          console.log('   User ID:', freshToken.user_id);
          console.log('   Nickname:', nickname || 'N/A');
          console.log('   Expira en:', Math.floor(freshToken.expires_in / 3600), 'horas\n');
        } catch (err) {
          console.error('❌ Error migrando token:', err.message);
          console.log('⚠️  Deberás reconectar ML manualmente después del deploy.');
          console.log('   URL: https://' + TENANT_CONFIG.subdomain + '.zupply.tech/api/auth/meli/connect\n');
        }
      }
    } else {
      console.log('✅ Tenant ya tiene ML conectado');
      console.log('   User ID:', tenant.mlIntegration.userId);
      console.log('   Nickname:', tenant.mlIntegration.nickname || 'N/A');
      console.log('   Connected:', tenant.mlIntegration.connected);
      console.log('\n');
    }

    // 3. CONTAR REGISTROS SIN TENANT
    console.log('📊 Analizando datos sin tenant...');
    const counts = {
      clientes: await Cliente.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      }),
      envios: await Envio.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      })
    };

    try {
      const Zona = require('../models/Zona');
      counts.zonas = await Zona.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      });
    } catch {}

    try {
      const Chofer = require('../models/Chofer');
      counts.choferes = await Chofer.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      });
    } catch {}

    console.log('   Clientes sin tenant:', counts.clientes);
    console.log('   Envíos sin tenant:', counts.envios);
    if (counts.zonas !== undefined) console.log('   Zonas sin tenant:', counts.zonas);
    if (counts.choferes !== undefined) console.log('   Choferes sin tenant:', counts.choferes);
    console.log('');

    // 4. MIGRAR CLIENTES
    if (counts.clientes > 0) {
      console.log('📝 Migrando clientes...');
      const result = await Cliente.updateMany(
        { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
        { $set: { tenantId: tenant._id } }
      );
      console.log(`✅ ${result.modifiedCount} clientes migrados\n`);
    } else {
      console.log('✅ No hay clientes para migrar\n');
    }

    // 5. MIGRAR ENVÍOS
    if (counts.envios > 0) {
      console.log('📝 Migrando envíos...');
      console.log('   ⏳ Esto puede tomar varios minutos para', counts.envios, 'envíos...');
      
      const result = await Envio.updateMany(
        { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
        { $set: { tenantId: tenant._id } }
      );
      console.log(`✅ ${result.modifiedCount} envíos migrados\n`);
    } else {
      console.log('✅ No hay envíos para migrar\n');
    }

    // 6. MIGRAR ZONAS
    if (counts.zonas !== undefined && counts.zonas > 0) {
      console.log('📝 Migrando zonas...');
      const Zona = require('../models/Zona');
      const result = await Zona.updateMany(
        { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
        { $set: { tenantId: tenant._id } }
      );
      console.log(`✅ ${result.modifiedCount} zonas migradas\n`);
    }

    // 7. MIGRAR CHOFERES
    if (counts.choferes !== undefined && counts.choferes > 0) {
      console.log('📝 Migrando choferes...');
      const Chofer = require('../models/Chofer');
      const result = await Chofer.updateMany(
        { $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
        { $set: { tenantId: tenant._id } }
      );
      console.log(`✅ ${result.modifiedCount} choferes migrados\n`);
    }

    // 8. RESUMEN FINAL
    console.log('\n========== RESUMEN DE MIGRACIÓN ==========\n');
    console.log('📊 TENANT:');
    console.log('   ID:', tenant._id.toString());
    console.log('   Subdomain:', tenant.subdomain);
    console.log('   Nombre:', tenant.companyName);
    console.log('   URL:', 'https://' + tenant.subdomain + '.zupply.tech');
    console.log('   ML Conectado:', tenant.mlIntegration?.connected ? '✅ SÍ' : '❌ NO');
    if (tenant.mlIntegration?.userId) {
      console.log('   ML User ID:', tenant.mlIntegration.userId);
      console.log('   ML Nickname:', tenant.mlIntegration.nickname || 'N/A');
    }
    
    console.log('\n📊 REGISTROS ASOCIADOS AL TENANT:');
    const finalStats = {
      clientes: await Cliente.countDocuments({ tenantId: tenant._id }),
      envios: await Envio.countDocuments({ tenantId: tenant._id })
    };
    
    try {
      const Zona = require('../models/Zona');
      finalStats.zonas = await Zona.countDocuments({ tenantId: tenant._id });
    } catch {}
    
    try {
      const Chofer = require('../models/Chofer');
      finalStats.choferes = await Chofer.countDocuments({ tenantId: tenant._id });
    } catch {}
    
    console.log('   Clientes:', finalStats.clientes);
    console.log('   Envíos:', finalStats.envios);
    if (finalStats.zonas !== undefined) console.log('   Zonas:', finalStats.zonas);
    if (finalStats.choferes !== undefined) console.log('   Choferes:', finalStats.choferes);

    // 9. VERIFICACIÓN FINAL
    console.log('\n📊 VERIFICACIÓN DE INTEGRIDAD:');
    const pendientes = {
      clientes: await Cliente.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      }),
      envios: await Envio.countDocuments({ 
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }]
      })
    };

    if (pendientes.clientes === 0 && pendientes.envios === 0) {
      console.log('   ✅ PERFECTO - Todos los registros tienen tenantId');
    } else {
      console.log('   ⚠️  Registros pendientes:', pendientes);
      console.log('   Ejecutá el script nuevamente para migrarlos.');
    }

    if (!tenant.mlIntegration?.connected) {
      console.log('\n⚠️  ACCIÓN REQUERIDA DESPUÉS DEL DEPLOY:');
      console.log('   1. Configurar DNS para: ' + TENANT_CONFIG.subdomain + '.zupply.tech');
      console.log('   2. Reconectar MercadoLibre en:');
      console.log('      https://' + TENANT_CONFIG.subdomain + '.zupply.tech/api/auth/meli/connect');
    } else {
      console.log('\n✅ TODO LISTO PARA PRODUCCIÓN');
      console.log('   Solo falta configurar DNS: ' + TENANT_CONFIG.subdomain + '.zupply.tech → Render');
    }

    console.log('\n==========================================\n');

    await mongoose.disconnect();
    console.log('✅ Migración completada exitosamente\n');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ ERROR EN MIGRACIÓN:', err);
    console.error(err.stack);
    
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

migrateToMultiTenant();
