const Redis = require('ioredis');
const { promisify } = require('util');

// Redis client variables
let redisClient;
let redisEnabled = process.env.REDIS_ENABLED !== 'false'; // Default to enabled unless explicitly disabled
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;

// Helper for dev-only logging
const devLog = (...args) => {
    if (process.env.NODE_ENV !== 'production') {
        console.log(...args);
    }
};

devLog('Redis URL:', process.env.REDIS_URL ? 'Configured' : 'Not set');

/**
 * Initialize Redis client
 * @returns {Object} Redis client instance
 */
const initRedisClient = () => {
  try {
    if (!redisEnabled) {
      devLog('Redis caching is explicitly disabled');
      return null;
    }
    
    connectionAttempts++;
    devLog(`Redis connection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);
    
    // Log the Redis configuration for debugging (dev only, no sensitive data)
    devLog('Redis configuration:');
    devLog(`- Using URL: ${!!process.env.REDIS_URL}`);
    devLog(`- TLS Enabled: ${process.env.REDIS_USE_TLS === 'true'}`);
    
    // Check if we have a Redis URL (preferred for cloud services)
    if (process.env.REDIS_URL && !process.env.REDIS_URL.includes('your-redis-host')) {
      devLog('Connecting to Redis using connection URL');
      
      // Configure connection options for Redis Cloud
      const connectionOptions = {
        maxRetriesPerRequest: null, // BullMQ requires this to be null
        enableReadyCheck: true,
        enableOfflineQueue: true,
        reconnectOnError: (err) => {
          devLog(`Redis reconnect triggered: ${err.message}`);
          const targetError = 'READONLY';
          return err.message.includes(targetError) || err.message.includes('ETIMEDOUT');
        },
        retryStrategy: (times) => {
          // Only use retry strategy from env if explicitly enabled
          if (process.env.REDIS_RETRY_STRATEGY !== 'true') {
            return null; // No retry if not enabled
          }
          
          const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '10', 10);
          const delay = Math.min(times * 500, 10000); // Longer delays with higher ceiling
          devLog(`Redis retry: attempt ${times}/${maxRetries}`);
          if (times > maxRetries) {
            devLog(`Redis connection failed after ${maxRetries} retries`);
            return null; // Stop retrying after max attempts
          }
          return delay;
        },
        connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '30000', 10), // Default 30 seconds timeout
        disconnectTimeout: 5000, // 5 seconds disconnect timeout
        keepAlive: process.env.REDIS_KEEP_ALIVE === 'true' ? 10000 : 0 // Enable keepAlive if configured
      };
      
      // Add TLS options if TLS is enabled
      if (process.env.REDIS_USE_TLS === 'true') {
        devLog('Redis TLS enabled');
        connectionOptions.tls = {
          rejectUnauthorized: false // Less strict for testing environments
        };
      }
      
      return new Redis(process.env.REDIS_URL, connectionOptions);
    }
    
    // Fallback to individual connection parameters (use 'redis' for Docker, 'localhost' for local)
    const defaultHost = process.env.NODE_ENV === 'development' ? 'redis' : 'localhost';
    devLog('Redis URL not found, using fallback config');
    const redisConfig = {
      host: process.env.REDIS_HOST || defaultHost,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // BullMQ requires this to be null
      enableReadyCheck: true,
      enableOfflineQueue: true,
      reconnectOnError: (err) => {
        devLog(`Redis reconnect triggered: ${err.message}`);
        const targetError = 'READONLY';
        return err.message.includes(targetError) || err.message.includes('ETIMEDOUT');
      },
      retryStrategy: (times) => {
        // Only use retry strategy from env if explicitly enabled
        if (process.env.REDIS_RETRY_STRATEGY !== 'true') {
          return null; // No retry if not enabled
        }
        
        const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '10', 10);
        const delay = Math.min(times * 500, 10000); // Longer delays with higher ceiling
        devLog(`Redis retry: attempt ${times}/${maxRetries}`);
        if (times > maxRetries) {
          devLog(`Redis connection failed after ${maxRetries} retries`);
          return null; // Stop retrying after max attempts
        }
        return delay;
      },
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '30000', 10),
      disconnectTimeout: 5000, 
      keepAlive: process.env.REDIS_KEEP_ALIVE === 'true' ? 10000 : 0,
      tls: process.env.REDIS_USE_TLS === 'true' ? {} : undefined
    };

    devLog('Creating Redis client');
    const client = new Redis(redisConfig);
    
    // Handle connection events
    client.on('error', (error) => {
      console.error('Redis connection error:', error);
      // Don't disable Redis on every error, just log it
      if (error.code === 'ECONNREFUSED') {
        devLog('Redis connection refused');
        // Only disable if we've exceeded max connection attempts
        if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
          devLog(`Max connection attempts reached, disabling Redis`);
          redisEnabled = false;
        }
      } else if (error.code === 'ETIMEDOUT') {
        devLog('Redis connection timed out');
        // Don't disable Redis on timeout, retry might succeed
        devLog(`Connection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);
      } else {
        devLog(`Redis error: ${error.message}`);
      }
    });
    
    client.on('connect', () => {
      devLog('Redis connected');
      redisEnabled = true;
    });
    
    client.on('ready', () => {
      devLog('Redis ready');
      redisEnabled = true;
      // Reset connection attempts on successful connection
      connectionAttempts = 0;
      // Emit a ready event that can be listened to by other modules
      client.emit('redis_ready', true);
    });
    
    client.on('reconnecting', (delay) => {
      devLog(`Redis reconnecting...`);
    });
    
    client.on('end', () => {
      devLog('Redis connection ended');
    });
    
    // Handle close events
    client.on('close', () => {
      devLog('Redis connection closed');
    });
    
    return client;
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    redisEnabled = false;
    return null;
  }
};

/**
 * Get Redis client instance (singleton pattern)
 * @returns {Object} Redis client
 */
const getRedisClient = () => {
  if (!redisClient) {
    redisClient = initRedisClient();
    
    // Log whether we got a client
    if (redisClient) {
      devLog('Redis Client Initialized');
    } else {
      devLog('Redis Client Initialization Failed');
    }
  }
  return redisClient;
};

/**
 * Check if Redis is enabled and connected
 * @returns {Boolean} Redis status
 */
const isRedisAvailable = () => {
  // Force initialization if not already done
  if (!redisClient) {
    getRedisClient();
  }
  return redisEnabled && redisClient && redisClient.status === 'ready';
};

module.exports = {
  getRedisClient,
  isRedisAvailable,
  initRedisClient
}; 