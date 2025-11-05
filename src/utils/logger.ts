import winston from 'winston';
import { config } from './config';

/**
 * Safe JSON stringifier that handles circular references and Buffers
 * Replaces circular references with "[Circular]" and Buffers with readable descriptions
 */
function safeStringify(obj: any, indent: number = 2): string {
  const seen = new WeakSet();

  return JSON.stringify(
    obj,
    (_key, value) => {
      // Handle Buffers and typed arrays to avoid logging huge arrays of numbers
      if (Buffer.isBuffer(value)) {
        return `[Buffer: ${value.length} bytes]`;
      }
      if (value instanceof Uint8Array) {
        return `[Uint8Array: ${value.length} bytes]`;
      }
      if (value instanceof ArrayBuffer) {
        return `[ArrayBuffer: ${value.byteLength} bytes]`;
      }

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    },
    indent
  );
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    if (Object.keys(meta).length > 0) {
      log += ` ${safeStringify(meta, 2)}`;
    }

    return log;
  })
);

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync('logs', { recursive: true });
} catch (error) {
  // Directory already exists or other error, continue
}

export { logger };

export const logError = (message: string, error?: Error, meta?: Record<string, any>) => {
  const logData = {
    ...meta,
    ...(error && {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    })
  };
  
  logger.error(message, logData);
};

export const logWarning = (message: string, meta?: Record<string, any>) => {
  logger.warn(message, meta);
};

export const logInfo = (message: string, meta?: Record<string, any>) => {
  logger.info(message, meta);
};

export const logDebug = (message: string, meta?: Record<string, any>) => {
  logger.debug(message, meta);
};

export const logDiscordEvent = (event: string, data?: Record<string, any>) => {
  logger.info(`Discord Event: ${event}`, {
    event,
    ...data
  });
};

export const logAPICall = (method: string, endpoint: string, status?: number, duration?: number) => {
  logger.info(`API Call: ${method} ${endpoint}`, {
    method,
    endpoint,
    status,
    duration
  });
};

export const logRecordingEvent = (event: string, sessionId: string, data?: Record<string, any>) => {
  logger.info(`Recording Event: ${event}`, {
    event,
    sessionId,
    ...data
  });
};

/**
 * Sanitize axios error to prevent logging large file buffers
 * This is critical for upload errors where error.config.data can contain multi-megabyte buffers
 */
export const sanitizeAxiosError = (error: any): any => {
  if (!error) return error;

  // If it's an axios error with config.data containing a buffer
  if (error.config?.data) {
    const dataSize = Buffer.isBuffer(error.config.data)
      ? error.config.data.length
      : (typeof error.config.data === 'object' ? JSON.stringify(error.config.data).length : 0);

    return {
      message: error.message,
      name: error.name,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      dataSize: `${Math.round(dataSize / 1024)}KB`,
      // Exclude error.config.data to avoid logging large buffers
      headers: error.config?.headers ? Object.keys(error.config.headers) : undefined,
      stack: error.stack
    };
  }

  // For non-axios errors, just return basic error info
  return {
    message: error.message,
    name: error.name,
    code: error.code,
    stack: error.stack
  };
};