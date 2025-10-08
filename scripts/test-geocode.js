#!/usr/bin/env node
const mongoose = require('mongoose');
const Envio = require('../models/Envio');
const { geocodeDireccion } = require('../utils/geocode');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('✓ Conectado a MongoDB');

  // Tomar 5 envíos con coordenadas malas/sospechosas
  const envios = await Envio.find({
    $or: [
      { latitud: null },
      { latitud: 0 },
      { geocode_source: { $ne: 'mercadolibre' } } // No son de ML
    ]
  }).limit(5);

  console.log(`\n🔍 Testeando ${envios.length} envíos:\n`);

  for (const envio of envios) {
    console.log('─'.repeat(60));
    console.log(`ID: ${envio._id}`);
    console.log(`Dirección: ${envio.direccion}`);
    console.log(`Partido: ${envio.partido}`);
    console.log(`CP: ${envio.codigo_postal}`);
    console.log(`Coords VIEJAS: ${envio.latitud}, ${envio.longitud}`);
    console.log(`Source: ${envio.geocode_source || 'desconocido'}`);

    try {
      // Re-geocodificar
      const coords = await geocodeDireccion({
        direccion: envio.direccion,
        codigo_postal: envio.codigo_postal,
        partido: envio.partido,
        latitud: envio.latitud,
        longitud: envio.longitud
      });

      if (coords) {
        console.log(`✅ Coords NUEVAS: ${coords.lat}, ${coords.lon}`);
        console.log(`   Source: ${coords.source}`);
        
        // Actualizar en DB
        await Envio.updateOne(
          { _id: envio._id },
          {
            $set: {
              latitud: coords.lat,
              longitud: coords.lon,
              geocode_source: coords.source
            }
          }
        );
        console.log('   💾 Guardado en DB');
      } else {
        console.log('❌ No se pudo geocodificar');
      }

    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
    }

    // Esperar 1 seg (rate limit de Google)
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n✓ Test completado\n');
  await mongoose.disconnect();
}

main().catch(console.error);
