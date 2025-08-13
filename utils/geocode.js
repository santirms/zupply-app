// Node 18+ ya tiene fetch global. Si usás Node 16, instala node-fetch.
async function geocodeDireccion({ direccion, codigo_postal, partido }) {
  const q = [direccion, codigo_postal && `CP ${codigo_postal}`, partido, 'Argentina']
    .filter(Boolean).join(', ');

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q, format: 'json', addressdetails: '0', limit: '1' });

  const res = await fetch(url, { headers: { 'User-Agent': 'Zupply/1.0 (contacto@tu-dominio.com)' } });
  if (!res.ok) return null;
  const json = await res.json();
  if (!Array.isArray(json) || !json.length) return null;

  return { lat: Number(json[0].lat), lon: Number(json[0].lon) };
}

module.exports = { geocodeDireccion };

