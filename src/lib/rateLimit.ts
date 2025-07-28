import NodeCache from 'node-cache';
import { logger, logRateLimit } from './logger';
import { authService } from './auth';

// Rate limit configurations for different user types and endpoints
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum requests per window
  message: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

const rateLimitConfigs: Record<string, RateLimitConfig> = {
  // Medical queries - most restrictive
  'medical-query': {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 queries per minute
    message: 'Too many medical queries. Please wait before asking another question.',
  },

  // Drug dosage calculations
  'dosage-calculation': {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 calculations per minute
    message: 'Too many dosage calculations. Please wait before making another calculation.',
  },

  // Authentication attempts
  'auth-login': {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: 'Too many login attempts. Please try again later.',
  },

  // Password reset attempts
  'auth-reset': {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 attempts per hour
    message: 'Too many password reset attempts. Please try again later.',
  },

  // General API requests
  'api-general': {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests. Please slow down.',
  },

  // Search queries
  'search': {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    message: 'Too many search requests. Please wait before searching again.',
  },
};

// Role-based multipliers for rate limits
const roleMultipliers: Record<string, number> = {
  student: 0.5, // Students get half the rate limit
  resident: 0.8, // Residents get 80% of the rate limit
  nurse: 1.0, // Nurses get full rate limit
  physician: 2.0, // Physicians get double the rate limit
  admin: 5.0, // Admins get 5x the rate limit
};

class RateLimiter {
  private cache: NodeCache;
  private configs: Record<string, RateLimitConfig>;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 3600, // 1 hour default TTL
      checkperiod: 120, // Check for expired keys every 2 minutes
    });
    this.configs = rateLimitConfigs;
  }

  // Check if request is within rate limit
  async checkRateLimit(
    identifier: string,
    endpoint: string,
    userRole?: string
  ): Promise<{ allowed: boolean; resetTime?: Date; remaining?: number }> {
    const config = this.configs[endpoint] || this.configs['api-general'];
    const key = `${endpoint}:${identifier}`;
    
    // Get role multiplier
    const multiplier = userRole ? roleMultipliers[userRole] || 1.0 : 1.0;
    const adjustedMax = Math.floor(config.max * multiplier);

    // Get current count from cache
    const current = this.cache.get<number>(key) || 0;
    const resetTime = new Date(Date.now() + config.windowMs);

    if (current >= adjustedMax) {
      // Rate limit exceeded
      logRateLimit(identifier, endpoint, adjustedMax);
      return {
        allowed: false,
        resetTime,
        remaining: 0,
      };
    }

    // Increment counter
    const newCount = current + 1;
    this.cache.set(key, newCount, config.windowMs / 1000);

    return {
      allowed: true,
      resetTime,
      remaining: adjustedMax - newCount,
    };
  }

  // Reset rate limit for a specific identifier and endpoint
  resetRateLimit(identifier: string, endpoint: string): void {
    const key = `${endpoint}:${identifier}`;
    this.cache.del(key);
    logger.info('Rate limit reset', { identifier, endpoint });
  }

  // Get current rate limit status
  getRateLimitStatus(
    identifier: string,
    endpoint: string,
    userRole?: string
  ): { current: number; max: number; resetTime: Date } {
    const config = this.configs[endpoint] || this.configs['api-general'];
    const key = `${endpoint}:${identifier}`;
    const multiplier = userRole ? roleMultipliers[userRole] || 1.0 : 1.0;
    const adjustedMax = Math.floor(config.max * multiplier);
    
    const current = this.cache.get<number>(key) || 0;
    const resetTime = new Date(Date.now() + config.windowMs);

    return {
      current,
      max: adjustedMax,
      resetTime,
    };
  }

  // Middleware function for Express-like applications
  createMiddleware(endpoint: string) {
    return async (req: any, res: any, next: any) => {
      try {
        // Get identifier (IP address or user ID)
        const identifier = this.getIdentifier(req);
        
        // Get user role if authenticated
        const user = authService.getCurrentUser();
        const userRole = user?.user_metadata?.role;

        // Check rate limit
        const result = await this.checkRateLimit(identifier, endpoint, userRole);

        if (!result.allowed) {
          const config = this.configs[endpoint] || this.configs['api-general'];
          
          res.status(429).json({
            error: 'Rate limit exceeded',
            message: config.message,
            resetTime: result.resetTime,
          });
          return;
        }

        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': this.configs[endpoint]?.max || 100,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': result.resetTime?.getTime(),
        });

        next();
      } catch (error) {
        logger.error('Rate limiting error:', error);
        next(); // Continue on error to avoid breaking the application
      }
    };
  }

  // Get identifier from request (IP or user ID)
  private getIdentifier(req: any): string {
    const user = authService.getCurrentUser();
    
    if (user) {
      return `user:${user.id}`;
    }

    // Fallback to IP address
    const ip = req.ip || 
               req.connection?.remoteAddress || 
               req.socket?.remoteAddress ||
               req.headers['x-forwarded-for']?.split(',')[0] ||
               'unknown';
    
    return `ip:${ip}`;
  }

  // Clear all rate limits (admin function)
  clearAllRateLimits(): void {
    this.cache.flushAll();
    logger.info('All rate limits cleared');
  }

  // Get rate limit statistics
  getStatistics(): { totalKeys: number; keysByEndpoint: Record<string, number> } {
    const keys = this.cache.keys();
    const keysByEndpoint: Record<string, number> = {};

    keys.forEach(key => {
      const [endpoint] = key.split(':');
      keysByEndpoint[endpoint] = (keysByEndpoint[endpoint] || 0) + 1;
    });

    return {
      totalKeys: keys.length,
      keysByEndpoint,
    };
  }
}

// Create singleton instance
export const rateLimiter = new RateLimiter();

// Helper function for client-side rate limiting
export async function checkClientRateLimit(
  endpoint: string,
  identifier?: string
): Promise<{ allowed: boolean; message?: string; resetTime?: Date }> {
  try {
    const user = authService.getCurrentUser();
    const userId = identifier || user?.id || 'anonymous';
    const userRole = user?.user_metadata?.role;

    const result = await rateLimiter.checkRateLimit(userId, endpoint, userRole);

    if (!result.allowed) {
      const config = rateLimitConfigs[endpoint] || rateLimitConfigs['api-general'];
      return {
        allowed: false,
        message: config.message,
        resetTime: result.resetTime,
      };
    }

    return { allowed: true };
  } catch (error) {
    logger.error('Client rate limit check failed:', error);
    return { allowed: true }; // Fail open to avoid breaking functionality
  }
}

// Medical query specific rate limiting
export async function checkMedicalQueryLimit(query: string): Promise<boolean> {
  const result = await checkClientRateLimit('medical-query');
  
  if (!result.allowed) {
    logger.warn('Medical query rate limit exceeded', {
      query_length: query.length,
      message: result.message,
    });
    return false;
  }

  return true;
}

// Dosage calculation specific rate limiting
export async function checkDosageCalculationLimit(): Promise<boolean> {
  const result = await checkClientRateLimit('dosage-calculation');
  
  if (!result.allowed) {
    logger.warn('Dosage calculation rate limit exceeded');
    return false;
  }

  return true;
}

export default rateLimiter;