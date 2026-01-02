// utils/timezone.js
const moment = require('moment-timezone');

// Zona horaria de Argentina
const TIMEZONE_ARGENTINA = 'America/Argentina/Buenos_Aires';

/**
 * Obtiene la fecha y hora actual en zona horaria de Argentina
 * @returns {Date} - Fecha actual en timezone de Argentina (como objeto Date para MongoDB)
 */
function getFechaArgentina() {
  return moment.tz(TIMEZONE_ARGENTINA).toDate();
}

/**
 * Obtiene la hora actual en formato HH:mm:ss en zona horaria de Argentina
 * @returns {string} - Hora en formato 'HH:mm:ss'
 */
function getHoraArgentina() {
  return moment.tz(TIMEZONE_ARGENTINA).format('HH:mm:ss');
}

/**
 * Obtiene fecha y hora en formato completo para Argentina
 * @returns {Object} - { fecha: Date, hora: string }
 */
function getFechaHoraArgentina() {
  const ahora = moment.tz(TIMEZONE_ARGENTINA);
  return {
    fecha: ahora.toDate(),
    hora: ahora.format('HH:mm:ss')
  };
}

/**
 * Convierte una fecha UTC a fecha Argentina
 * @param {Date} fechaUtc - Fecha en UTC
 * @returns {Date} - Fecha convertida a timezone de Argentina
 */
function convertirAArgentina(fechaUtc) {
  return moment(fechaUtc).tz(TIMEZONE_ARGENTINA).toDate();
}

/**
 * Formatea una fecha en zona horaria de Argentina
 * @param {Date} fecha - Fecha a formatear
 * @param {string} formato - Formato deseado (default: 'DD/MM/YYYY HH:mm:ss')
 * @returns {string} - Fecha formateada
 */
function formatearFechaArgentina(fecha, formato = 'DD/MM/YYYY HH:mm:ss') {
  return moment(fecha).tz(TIMEZONE_ARGENTINA).format(formato);
}

/**
 * Obtiene el timestamp actual en Argentina (para debugging)
 * @returns {string} - Timestamp en formato ISO en timezone Argentina
 */
function getTimestampArgentina() {
  return moment.tz(TIMEZONE_ARGENTINA).format();
}

module.exports = {
  TIMEZONE_ARGENTINA,
  getFechaArgentina,
  getHoraArgentina,
  getFechaHoraArgentina,
  convertirAArgentina,
  formatearFechaArgentina,
  getTimestampArgentina
};
