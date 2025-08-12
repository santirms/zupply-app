// controllers/services/geocode.js  (o /services/geocode.js si lo mueves)
let _fetch = global.fetch || (async (...args) => {
  const { default: f } = await import('node-fetch');
  return f(...args);
});

async function geocodeAddress(address) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
  const res = await _fetch(url, {
    headers: {
      'User-Agent': 'ZupplyApp/1.0 (contacto@tu-dominio.com)',
      'Accept-Language': 'es'
    }
  });
  if (!res.ok) throw new Error('Geocoding HTTP ' + res.status);
  const data = await res.json();
  if (!data.length) throw new Error('Sin resultados para: ' + address);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

module.exports = { geocodeAddress };
