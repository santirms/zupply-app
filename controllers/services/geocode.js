// backend/controllers/services/geocode.js
async function geocodeAddress(address) {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`,
    { headers: { 'Accept-Language': 'es' } }
  );
  const data = await resp.json();
  if (!data.length) throw new Error('No se pudo geolocalizar');
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

module.exports = { geocodeAddress };
