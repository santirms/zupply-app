// utils/geocode.js
const axios = require('axios');

/**
 * Geocodifica una dirección usando Google Maps Geocoding API
 * Optimizado para direcciones de Argentina (AMBA)
 */
async function geocodeDireccion({ direccion, codigo_postal, partido, latitud, longitud }) {
  // 1. Si ya tenemos coordenadas (de MeLi), usarlas directamente
  if (latitud && longitud && isValidCoord(latitud, longitud)) {
    console.log('📍 Usando coordenadas de MercadoLibre:', { latitud, longitud });
    return { lat: Number(latitud), lon: Number(longitud), source: 'mercadolibre' };
  }

  // 2. Intentar con Google Maps
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ GOOGLE_MAPS_API_KEY no configurada, sin geocoding');
    return null;
  }

  try {
    const address = buildAddress({ direccion, codigo_postal, partido });
    console.log('🔍 Geocodificando con Google:', address);

    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address,
        region: 'ar',           // Priorizar resultados de Argentina
        components: 'country:AR', // Solo Argentina
        key: apiKey
      },
      timeout: 5000
    });

    if (response.data.status !== 'OK' || !response.data.results?.[0]) {
      console.warn('❌ Google Maps no encontró resultados:', response.data.status);
      return null;
    }

    const result = response.data.results[0];
    const location = result.geometry.location;

    // Validar que esté en Argentina (aproximadamente)
    if (!isInArgentina(location.lat, location.lng)) {
      console.warn('❌ Coordenadas fuera de Argentina:', location);
      return null;
    }

    console.log('✅ Geocodificado con Google:', { 
      lat: location.lat, 
      lon: location.lng,
      formatted: result.formatted_address 
    });

    return { 
      lat: location.lat, 
      lon: location.lng, 
      source: 'google',
      formatted_address: result.formatted_address 
    };

  } catch (error) {
    console.error('❌ Error geocodificando con Google:', error.message);
    return null;
  }
}

/**
 * Construye string de dirección optimizado para Argentina
 */
function buildAddress({ direccion, codigo_postal, partido }) {
  const parts = [];

  // Limpiar dirección
  if (direccion) {
    let dir = String(direccion).trim();
    // Normalizar "Calle 123" → "123" si empieza con "Calle"
    dir = dir.replace(/^calle\s+/i, '');
    parts.push(dir);
  }

  // Agregar partido (crítico para AMBA)
  if (partido) {
    const part = String(partido).trim();
    // Si el partido tiene sufijo de zona (N, S, E, O), quitarlo
    const cleanPart = part.replace(/\s+(N|S|E|O|NE|NO|SE|SO)$/i, '').trim();
    parts.push(cleanPart);
  }

  // CP solo si es válido argentino (4 dígitos o B1234XXX)
  if (codigo_postal) {
    const cp = String(codigo_postal).trim();
    if (/^[A-Z]?\d{4}[A-Z]{0,3}$/i.test(cp)) {
      parts.push(cp);
    }
  }

  // Siempre agregar Provincia y País para desambiguar
  parts.push('Provincia de Buenos Aires');
  parts.push('Argentina');

  return parts.join(', ');
}

/**
 * Valida que las coordenadas sean válidas
 */
function isValidCoord(lat, lon) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  return (
    !isNaN(latNum) && 
    !isNaN(lonNum) &&
    latNum !== 0 && 
    lonNum !== 0 &&
    Math.abs(latNum) <= 90 &&
    Math.abs(lonNum) <= 180
  );
}

/**
 * Verifica que las coordenadas estén en Argentina (bounding box aproximado)
 */
function isInArgentina(lat, lng) {
  // Bounding box de Argentina (aproximado)
  // Norte: -21.78, Sur: -55.05, Oeste: -73.56, Este: -53.59
  return (
    lat >= -55.1 && lat <= -21.7 &&
    lng >= -73.6 && lng <= -53.5
  );
}

module.exports = { geocodeDireccion };
