/**
 * Normaliza un número de teléfono argentino para uso en APIs
 * Quita espacios, guiones, paréntesis y el símbolo +
 *
 * @param {string} phone - Teléfono en cualquier formato
 * @returns {string|null} - Teléfono limpio (solo dígitos) o null
 *
 * @example
 * normalizePhone("+54 9 11 1234-5678") → "5491112345678"
 * normalizePhone("11 1234-5678") → "1112345678"
 * normalizePhone("549 11 1234 5678") → "5491112345678"
 */
function normalizePhone(phone) {
  if (!phone) return null;

  // Convertir a string y quitar todo excepto dígitos
  const cleaned = String(phone).replace(/\D/g, '');

  if (!cleaned) return null;

  return cleaned;
}

/**
 * Formatea un número para WhatsApp (asegura que tenga código de país)
 *
 * @param {string} phone - Teléfono en cualquier formato
 * @returns {string|null} - Teléfono listo para wa.me o null
 *
 * @example
 * formatForWhatsApp("+54 9 11 1234-5678") → "5491112345678"
 * formatForWhatsApp("11 1234-5678") → "5491112345678" (asume Argentina)
 */
function formatForWhatsApp(phone) {
  const cleaned = normalizePhone(phone);
  if (!cleaned) return null;

  // Si ya tiene código de país (549...), dejarlo
  if (cleaned.startsWith('549')) {
    return cleaned;
  }

  // Si empieza con 54 pero no tiene el 9, agregarlo
  if (cleaned.startsWith('54') && !cleaned.startsWith('549')) {
    return '549' + cleaned.slice(2);
  }

  // Si solo tiene código de área + número (ej: 1112345678), agregar 549
  if (cleaned.length === 10 && cleaned.startsWith('11')) {
    return '549' + cleaned;
  }

  // Si tiene 15 adelante del área (formato viejo), convertirlo
  if (cleaned.startsWith('15')) {
    return '549' + cleaned.slice(2);
  }

  // Fallback: asumir que es argentino y agregar 549
  console.warn(`Formato de teléfono desconocido: ${phone}, agregando 549`);
  return '549' + cleaned;
}

/**
 * Valida que un teléfono argentino tenga formato correcto
 *
 * @param {string} phone - Teléfono a validar
 * @returns {boolean} - true si es válido
 */
function isValidArgentinePhone(phone) {
  const cleaned = normalizePhone(phone);
  if (!cleaned) return false;

  // Formato completo: 549 + código de área (2-4 dígitos) + número (6-8 dígitos)
  // Total: 12-14 dígitos
  if (cleaned.startsWith('549') && cleaned.length >= 12 && cleaned.length <= 14) {
    return true;
  }

  // Formato local: código de área + número (10 dígitos típico)
  if (cleaned.length >= 10 && cleaned.length <= 12) {
    return true;
  }

  return false;
}

module.exports = {
  normalizePhone,
  formatForWhatsApp,
  isValidArgentinePhone
};
