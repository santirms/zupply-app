const logger = require('../utils/logger');

/**
 * Middleware para loguear requests HTTP
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Generar ID único para el request
  req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Loguear cuando termine el response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const userId = req.user?._id || req.user?.id || null;

    // Solo loguear en producción si:
    // - Es error (4xx, 5xx)
    // - O es un endpoint importante (no assets estáticos)
    const shouldLog = res.statusCode >= 400 ||
                     !req.url.match(/\.(css|js|jpg|png|svg|ico|woff|woff2)$/);

    if (shouldLog) {
      logger.request(req.method, req.url, res.statusCode, duration, userId);
    }
  });

  next();
}

module.exports = requestLogger;
