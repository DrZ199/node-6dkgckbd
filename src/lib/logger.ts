import winston from 'winston';

// HIPAA-compliant log format that excludes sensitive data
const hipaaFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    // Remove sensitive data from logs
    const sanitizedMeta = sanitizeLogData(meta);
    
    return JSON.stringify({
      timestamp,
      level,
      message,
      stack,
      ...sanitizedMeta,
    });
  })
);

// Sanitize log data to remove sensitive information
function sanitizeLogData(data: any): any {
  const sensitive = [
    'password',
    'token',
    'apikey',
    'api_key',
    'secret',
    'license_number',
    'ssn',
    'social_security',
    'patient_id',
    'medical_record_number',
    'mrn',
  ];

  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const sanitized = { ...data };

  Object.keys(sanitized).forEach(key => {
    const lowerKey = key.toLowerCase();
    
    if (sensitive.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  });

  return sanitized;
}

// Create Winston logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: hipaaFormat,
  defaultMeta: {
    service: 'nelsongpt',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' }),
  ],
  
  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' }),
  ],
});

// Enhanced logger interface
interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
  security(event: string, meta?: any): void;
  medical(event: string, meta?: any): void;
  audit(event: string, meta?: any): void;
}

// Create enhanced logger with medical-specific methods
const enhancedLogger: Logger = {
  debug: (message: string, meta?: any) => {
    logger.debug(message, meta);
  },
  
  info: (message: string, meta?: any) => {
    logger.info(message, meta);
  },
  
  warn: (message: string, meta?: any) => {
    logger.warn(message, meta);
  },
  
  error: (message: string, meta?: any) => {
    logger.error(message, meta);
    
    // Send to error monitoring service in production
    if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
      // You could integrate with Sentry, LogRocket, etc.
      console.error('[PRODUCTION ERROR]', message, meta);
    }
  },
  
  security: (event: string, meta?: any) => {
    logger.warn(`[SECURITY] ${event}`, {
      ...meta,
      category: 'security',
      timestamp: new Date().toISOString(),
    });
  },
  
  medical: (event: string, meta?: any) => {
    logger.info(`[MEDICAL] ${event}`, {
      ...meta,
      category: 'medical',
      timestamp: new Date().toISOString(),
    });
  },
  
  audit: (event: string, meta?: any) => {
    logger.info(`[AUDIT] ${event}`, {
      ...meta,
      category: 'audit',
      timestamp: new Date().toISOString(),
    });
  },
};

// Error boundary integration
export function logError(error: Error, errorInfo?: any) {
  enhancedLogger.error('React Error Boundary caught an error', {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    errorInfo,
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  });
}

// Medical query logging (HIPAA compliant)
export function logMedicalQuery(query: string, userId?: string, responseTime?: number) {
  enhancedLogger.medical('Medical query processed', {
    query_length: query.length,
    query_type: detectQueryType(query),
    user_id: userId || 'anonymous',
    response_time_ms: responseTime,
    timestamp: new Date().toISOString(),
  });
}

// Detect query type for analytics (without logging actual content)
function detectQueryType(query: string): string {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes('dosage') || lowerQuery.includes('dose')) {
    return 'dosage_calculation';
  }
  if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent')) {
    return 'emergency_protocol';
  }
  if (lowerQuery.includes('symptom') || lowerQuery.includes('diagnosis')) {
    return 'symptom_analysis';
  }
  if (lowerQuery.includes('growth') || lowerQuery.includes('development')) {
    return 'growth_development';
  }
  
  return 'general_medical';
}

// Performance monitoring
export function logPerformance(operation: string, duration: number, meta?: any) {
  enhancedLogger.info(`Performance: ${operation}`, {
    operation,
    duration_ms: duration,
    ...meta,
  });
}

// Rate limiting events
export function logRateLimit(identifier: string, endpoint: string, limit: number) {
  enhancedLogger.warn('Rate limit exceeded', {
    identifier,
    endpoint,
    limit,
    timestamp: new Date().toISOString(),
  });
}

// Database operation logging
export function logDatabaseOperation(operation: string, table: string, duration?: number, error?: any) {
  if (error) {
    enhancedLogger.error(`Database operation failed: ${operation}`, {
      operation,
      table,
      duration_ms: duration,
      error: error.message,
    });
  } else {
    enhancedLogger.debug(`Database operation: ${operation}`, {
      operation,
      table,
      duration_ms: duration,
    });
  }
}

export { enhancedLogger as logger };
export default enhancedLogger;