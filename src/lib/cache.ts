import NodeCache from 'node-cache';
import { logger, logPerformance } from './logger';
import CryptoJS from 'crypto-js';

// Cache configurations for different types of data
interface CacheConfig {
  ttl: number; // Time to live in seconds
  checkPeriod: number; // Check for expired keys every X seconds
  maxKeys: number; // Maximum number of keys to store
  useClones: boolean; // Whether to clone objects
}

const cacheConfigs: Record<string, CacheConfig> = {
  // Medical content cache - longer TTL since content doesn't change often
  medical: {
    ttl: 24 * 60 * 60, // 24 hours
    checkPeriod: 60 * 60, // Check every hour
    maxKeys: 1000,
    useClones: true,
  },

  // Embeddings cache - very long TTL since embeddings rarely change
  embeddings: {
    ttl: 7 * 24 * 60 * 60, // 7 days
    checkPeriod: 6 * 60 * 60, // Check every 6 hours
    maxKeys: 5000,
    useClones: false,
  },

  // API response cache - shorter TTL for dynamic content
  api: {
    ttl: 5 * 60, // 5 minutes
    checkPeriod: 60, // Check every minute
    maxKeys: 500,
    useClones: true,
  },

  // User session cache - medium TTL
  session: {
    ttl: 30 * 60, // 30 minutes
    checkPeriod: 5 * 60, // Check every 5 minutes
    maxKeys: 1000,
    useClones: true,
  },

  // Search results cache - short TTL
  search: {
    ttl: 10 * 60, // 10 minutes
    checkPeriod: 2 * 60, // Check every 2 minutes
    maxKeys: 200,
    useClones: true,
  },
};

class CacheManager {
  private caches: Map<string, NodeCache>;
  private encryptionKey: string;

  constructor() {
    this.caches = new Map();
    this.encryptionKey = process.env.VITE_CACHE_ENCRYPTION_KEY || 'default-cache-key';
    this.initializeCaches();
    this.setupMonitoring();
  }

  // Initialize all cache instances
  private initializeCaches() {
    Object.entries(cacheConfigs).forEach(([name, config]) => {
      const cache = new NodeCache({
        stdTTL: config.ttl,
        checkperiod: config.checkPeriod,
        maxKeys: config.maxKeys,
        useClones: config.useClones,
        deleteOnExpire: true,
      });

      // Add event listeners for monitoring
      cache.on('set', (key, value) => {
        logger.debug(`Cache SET: ${name}:${key}`);
      });

      cache.on('del', (key, value) => {
        logger.debug(`Cache DEL: ${name}:${key}`);
      });

      cache.on('expired', (key, value) => {
        logger.debug(`Cache EXPIRED: ${name}:${key}`);
      });

      this.caches.set(name, cache);
    });

    logger.info('Cache manager initialized', {
      cacheTypes: Object.keys(cacheConfigs),
    });
  }

  // Setup cache monitoring and statistics
  private setupMonitoring() {
    // Log cache statistics every 15 minutes
    setInterval(() => {
      this.logCacheStatistics();
    }, 15 * 60 * 1000);
  }

  // Get cache instance
  private getCache(cacheType: string): NodeCache {
    const cache = this.caches.get(cacheType);
    if (!cache) {
      throw new Error(`Cache type '${cacheType}' not found`);
    }
    return cache;
  }

  // Generic get method with performance monitoring
  async get<T>(cacheType: string, key: string, encrypted: boolean = false): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      const cache = this.getCache(cacheType);
      const fullKey = `${cacheType}:${key}`;
      
      let value = cache.get<string | T>(fullKey);
      
      if (value === undefined) {
        logPerformance(`Cache MISS: ${cacheType}`, Date.now() - startTime);
        return null;
      }

      // Decrypt if needed
      if (encrypted && typeof value === 'string') {
        try {
          const decrypted = CryptoJS.AES.decrypt(value, this.encryptionKey).toString(CryptoJS.enc.Utf8);
          value = JSON.parse(decrypted) as T;
        } catch (error) {
          logger.error('Cache decryption failed', { key: fullKey, error });
          cache.del(fullKey);
          return null;
        }
      }

      logPerformance(`Cache HIT: ${cacheType}`, Date.now() - startTime);
      return value as T;
    } catch (error) {
      logger.error('Cache get failed', { cacheType, key, error });
      return null;
    }
  }

  // Generic set method with optional encryption
  async set<T>(
    cacheType: string,
    key: string,
    value: T,
    ttl?: number,
    encrypted: boolean = false
  ): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const cache = this.getCache(cacheType);
      const fullKey = `${cacheType}:${key}`;
      
      let valueToStore: string | T = value;

      // Encrypt if needed
      if (encrypted) {
        const jsonString = JSON.stringify(value);
        valueToStore = CryptoJS.AES.encrypt(jsonString, this.encryptionKey).toString();
      }

      const success = cache.set(fullKey, valueToStore, ttl);
      
      logPerformance(`Cache SET: ${cacheType}`, Date.now() - startTime);
      
      if (!success) {
        logger.warn('Cache set failed', { cacheType, key });
      }
      
      return success;
    } catch (error) {
      logger.error('Cache set failed', { cacheType, key, error });
      return false;
    }
  }

  // Delete from cache
  async delete(cacheType: string, key: string): Promise<boolean> {
    try {
      const cache = this.getCache(cacheType);
      const fullKey = `${cacheType}:${key}`;
      
      const deleteCount = cache.del(fullKey);
      return deleteCount > 0;
    } catch (error) {
      logger.error('Cache delete failed', { cacheType, key, error });
      return false;
    }
  }

  // Clear entire cache type
  async clear(cacheType: string): Promise<void> {
    try {
      const cache = this.getCache(cacheType);
      cache.flushAll();
      logger.info(`Cache cleared: ${cacheType}`);
    } catch (error) {
      logger.error('Cache clear failed', { cacheType, error });
    }
  }

  // Get or set pattern (cache-aside)
  async getOrSet<T>(
    cacheType: string,
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
    encrypted: boolean = false
  ): Promise<T | null> {
    // Try to get from cache first
    const cached = await this.get<T>(cacheType, key, encrypted);
    
    if (cached !== null) {
      return cached;
    }

    // Cache miss - get from factory function
    const startTime = Date.now();
    
    try {
      const value = await factory();
      
      if (value !== null && value !== undefined) {
        await this.set(cacheType, key, value, ttl, encrypted);
      }
      
      logPerformance(`Cache factory: ${cacheType}`, Date.now() - startTime);
      return value;
    } catch (error) {
      logger.error('Cache factory failed', { cacheType, key, error });
      return null;
    }
  }

  // Medical content specific methods
  async getMedicalContent(contentId: string) {
    return this.get('medical', contentId);
  }

  async setMedicalContent(contentId: string, content: any, ttl?: number) {
    return this.set('medical', contentId, content, ttl);
  }

  // Embeddings specific methods
  async getEmbedding(text: string) {
    const key = CryptoJS.SHA256(text).toString();
    return this.get<number[]>('embeddings', key);
  }

  async setEmbedding(text: string, embedding: number[], ttl?: number) {
    const key = CryptoJS.SHA256(text).toString();
    return this.set('embeddings', key, embedding, ttl);
  }

  // Search results caching
  async getSearchResults(query: string) {
    const key = CryptoJS.SHA256(query.toLowerCase()).toString();
    return this.get('search', key);
  }

  async setSearchResults(query: string, results: any, ttl?: number) {
    const key = CryptoJS.SHA256(query.toLowerCase()).toString();
    return this.set('search', key, results, ttl);
  }

  // API response caching
  async getApiResponse(endpoint: string, params?: any) {
    const key = params ? `${endpoint}:${JSON.stringify(params)}` : endpoint;
    const hashedKey = CryptoJS.SHA256(key).toString();
    return this.get('api', hashedKey);
  }

  async setApiResponse(endpoint: string, response: any, params?: any, ttl?: number) {
    const key = params ? `${endpoint}:${JSON.stringify(params)}` : endpoint;
    const hashedKey = CryptoJS.SHA256(key).toString();
    return this.set('api', hashedKey, response, ttl);
  }

  // Session caching (encrypted)
  async getSession(sessionId: string) {
    return this.get('session', sessionId, true);
  }

  async setSession(sessionId: string, sessionData: any, ttl?: number) {
    return this.set('session', sessionId, sessionData, ttl, true);
  }

  // Cache statistics
  getCacheStats(cacheType?: string): any {
    if (cacheType) {
      const cache = this.getCache(cacheType);
      return {
        keys: cache.keys().length,
        stats: cache.getStats(),
      };
    }

    const allStats: any = {};
    this.caches.forEach((cache, name) => {
      allStats[name] = {
        keys: cache.keys().length,
        stats: cache.getStats(),
      };
    });

    return allStats;
  }

  // Log cache statistics
  private logCacheStatistics() {
    const stats = this.getCacheStats();
    logger.info('Cache statistics', stats);
  }

  // Health check for cache system
  healthCheck(): { healthy: boolean; details: any } {
    try {
      const stats = this.getCacheStats();
      const healthy = Object.values(stats).every((cacheStats: any) => {
        return typeof cacheStats.stats === 'object';
      });

      return {
        healthy,
        details: stats,
      };
    } catch (error) {
      logger.error('Cache health check failed', error);
      return {
        healthy: false,
        details: { error: error.message },
      };
    }
  }

  // Warm up cache with commonly used data
  async warmUp() {
    logger.info('Starting cache warm-up');
    
    try {
      // Warm up medical content cache with frequently accessed items
      // This would typically load common medical procedures, drug info, etc.
      
      // Example warm-up (replace with actual implementation)
      const commonQueries = [
        'pediatric dosage',
        'emergency protocols',
        'growth charts',
        'vaccine schedule',
      ];

      for (const query of commonQueries) {
        // Pre-compute and cache embeddings for common queries
        // await this.getOrSet('embeddings', query, () => generateEmbedding(query));
      }

      logger.info('Cache warm-up completed');
    } catch (error) {
      logger.error('Cache warm-up failed', error);
    }
  }
}

// Create singleton instance
export const cacheManager = new CacheManager();

// Helper functions for common caching patterns
export async function withCache<T>(
  cacheType: string,
  key: string,
  factory: () => Promise<T>,
  ttl?: number
): Promise<T | null> {
  return cacheManager.getOrSet(cacheType, key, factory, ttl);
}

export async function invalidateCache(cacheType: string, pattern?: string) {
  if (pattern) {
    // If pattern matching is needed, implement it here
    // For now, we'll just clear the entire cache type
    await cacheManager.clear(cacheType);
  } else {
    await cacheManager.clear(cacheType);
  }
}

export default cacheManager;