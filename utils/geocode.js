// utils/geocode.js
// Node 18+ tiene fetch global. Si usás Node 16 instala node-fetch@2 y adaptá.
const UA = 'Zupply/1.0 (contacto@tu-dominio.com)';

async function qNominatim(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '0',
    limit: '1'
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;             // 429/403/etc
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return null;
  return { lat: Number(arr[0].lat), lon: Number(arr[0].lon) };
}

async function geocodeDireccion({ direccion, codigo_postal, partido }) {
  // Normalizaciones simples
  const cp = codigo_postal ? String(codigo_postal).trim() : '';
  const part = (partido || '').trim();

  // Fallbacks de menor a mayor alcance
  const tries = [
    [direccion, part, 'Provincia de Buenos Aires', 'Argentina'],
    [direccion, part, 'Buenos Aires', 'Argentina'],
    [direccion, cp && `CP ${cp}`, part, 'Argentina'],
    [direccion, 'Argentina'],
    [part, 'Provincia de Buenos Aires', 'Argentina'],
  ].map(v => v.filter(Boolean).join(', '));

  for (const q of tries) {
    try {
      const hit = await qNominatim(q);
      if (hit) return hit;
    } catch (_) {}
    // Respeta rate-limit de Nominatim (~1 req/seg)
    await new Promise(r => setTimeout(r, 1100));
  }
  return null;
}

module.exports = { geocodeDireccion };
