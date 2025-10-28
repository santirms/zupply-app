const winston = require('winston');
const path = require('path');
const util = require('util');

// Determinar ambiente
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Formato personalizado
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}] ${message}`;

    // Agregar metadata si existe
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    // Agregar stack trace para errores
    if (stack) {
      log += `\n${stack}`;
    }

    return log;
  })
);

// Configuración de transportes
const transports = [];

// Console (siempre activo, pero filtrado según ambiente)
transports.push(
  new winston.transports.Console({
    level: isProduction ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.colorize(),
      customFormat
    )
  })
);

// Archivo para errores (solo producción)
if (isProduction) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: customFormat
    })
  );

  // Archivo para todos los logs importantes
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: customFormat
    })
  );
}

// Crear logger
const logger = winston.createLogger({
  transports,
  // No salir en errores
  exitOnError: false
});

// Wrapper con métodos convenientes
const log = {
  /**
   * Debug - Solo en desarrollo
   * Para debugging temporal, coordenadas, datos intermedios
   */
  debug: (message, meta = {}) => {
    if (isDevelopment) {
      logger.debug(message, meta);
    }
  },

  /**
   * Info - Eventos importantes del sistema
   * Inicio/fin de procesos, creación de recursos, sync exitosa
   */
  info: (message, meta = {}) => {
    logger.info(message, meta);
  },

  /**
   * Warn - Situaciones anormales pero no críticas
   * Timeouts recuperables, datos faltantes, deprecations
   */
  warn: (message, meta = {}) => {
    logger.warn(message, meta);
  },

  /**
   * Error - Errores que requieren atención
   * Fallos de API, errores de DB, excepciones no manejadas
   */
  error: (message, meta = {}) => {
    logger.error(message, meta);
  },

  /**
   * ML - Logs específicos de integración con MercadoLibre
   * Para auditoría y certificación
   */
  ml: (action, orderId, meta = {}) => {
    logger.info(`[ML] ${action}`, {
      order_id: orderId,
      ...meta,
      integration: 'mercadolibre'
    });
  },

  /**
   * API - Logs de llamadas a APIs externas
   */
  api: (service, method, url, statusCode, duration) => {
    const level = statusCode >= 400 ? 'error' : 'info';
    logger[level](`[API] ${service} ${method} ${url}`, {
      service,
      method,
      url,
      status: statusCode,
      duration_ms: duration
    });
  },

  /**
   * Request - Log de request HTTP (para middleware)
   */
  request: (method, url, statusCode, duration, userId = null) => {
    logger.info(`[HTTP] ${method} ${url}`, {
      method,
      url,
      status: statusCode,
      duration_ms: duration,
      user_id: userId
    });
  }
};

// Stream para Morgan (si lo usás)
log.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

if (!global.__ZUUPLY_LOGGER_PATCHED__) {
  const forwardConsole = (level, args) => {
    if (!args || args.length === 0) return;
    const [first, ...rest] = args;

    if (first instanceof Error) {
      log[level](first.message, {
        stack: first.stack,
        extra: rest
      });
      return;
    }

    if (typeof first === 'string') {
      if (rest.length === 0) {
        log[level](first);
      } else if (rest.length === 1 && typeof rest[0] === 'object' && !Array.isArray(rest[0])) {
        log[level](first, rest[0]);
      } else {
        log[level](first, { args: rest });
      }
      return;
    }

    log[level](util.inspect(first, { depth: 3, breakLength: Infinity }), {
      args: rest
    });
  };

  console.log = (...args) => forwardConsole('info', args);
  console.info = (...args) => forwardConsole('info', args);
  console.warn = (...args) => forwardConsole('warn', args);
  console.error = (...args) => forwardConsole('error', args);
  console.debug = (...args) => forwardConsole('debug', args);

  global.__ZUUPLY_LOGGER_PATCHED__ = true;
}

module.exports = log;
