const { promisify } = require('util');
const { getRedisClient, isRedisAvailable } = require('../clients/redisClient');

class TokenBucketLimiter {
    constructor(options = {}) {
        // Force Redis initialization if not already done
        if (!isRedisAvailable()) {
            console.log('[Rate Limiter] Redis not ready, attempting to initialize...');
            // Try to initialize Redis
            this.redis = getRedisClient();
        } else {
            this.redis = options.redis || getRedisClient();
            console.log('[Rate Limiter] Redis is available');
        }
        
        // Check if Redis is available after initialization attempt
        if (!this.redis) {
            console.warn('[Rate Limiter] No Redis client available. Rate limiting will be disabled.');
        } else {
            console.log('[Rate Limiter] Using Redis client with status:', this.redis.status);
            
            // Add a listener for the ready event if the client exists
            if (this.redis.status !== 'ready') {
                this.redis.once('ready', () => {
                    console.log('[Rate Limiter] Redis client is now ready');
                });
            }
        }
        
        this.defaultBucketSize = options.defaultBucketSize || 100;
        this.defaultRefillRate = options.defaultRefillRate || 10;
        this.keyPrefix = options.keyPrefix || 'ratelimit:';
        this.keyExpiry = options.keyExpiry || 86400; // 24 hours
    }

    // Helper to generate Redis key
    getKey(identifier) {
        // Only log in development environment
        if (process.env.NODE_ENV !== 'production') {
            console.log('identifier generated my request ip identifier', identifier);
        }
        return `${this.keyPrefix}${identifier}`;
    }

    // Get or create bucket
    async getBucket(identifier, bucketSize, refillRate) {
        const key = this.getKey(identifier);
        const now = Date.now();
        
        try {
            // First try to get existing bucket
            const existingBucket = await this.redis.hgetall(key);
            
            if (!existingBucket || Object.keys(existingBucket).length === 0) {
                // Only create new bucket if it doesn't exist
                const newBucket = {
                    tokens: bucketSize,
                    lastRefill: now,
                    bucketSize,
                    refillRate
                };
                
                await this.redis.hmset(key, newBucket);
                await this.redis.expire(key, this.keyExpiry);
                
                if (process.env.NODE_ENV !== 'production') {
                    console.log('[Rate Limiter] Created new bucket:', newBucket);
                }
                return newBucket;
            }

            // Convert string values to numbers and ensure all required fields exist
            const bucket = {
                tokens: parseFloat(existingBucket.tokens || bucketSize),
                lastRefill: parseInt(existingBucket.lastRefill || now),
                bucketSize: parseFloat(existingBucket.bucketSize || bucketSize),
                refillRate: parseFloat(existingBucket.refillRate || refillRate)
            };

            // Validate the bucket values
            if (isNaN(bucket.tokens)) bucket.tokens = bucketSize;
            if (isNaN(bucket.lastRefill)) bucket.lastRefill = now;
            if (isNaN(bucket.bucketSize)) bucket.bucketSize = bucketSize;
            if (isNaN(bucket.refillRate)) bucket.refillRate = refillRate;

            if (process.env.NODE_ENV !== 'production') {
                console.log('[Rate Limiter] Retrieved existing bucket:', bucket);
            }
            return bucket;
        } catch (error) {
            console.error('[Rate Limiter] Error in getBucket:', error);
            // Return default bucket on error
            return {
                tokens: bucketSize,
                lastRefill: now,
                bucketSize,
                refillRate
            };
        }
    }

    // Calculate token refill
    calculateRefill(bucket, now) {
        if (!bucket || typeof bucket.lastRefill !== 'number' || typeof bucket.tokens !== 'number') {
            console.error('[Rate Limiter] Invalid bucket state:', bucket);
            return 0;
        }

        const timePassed = (now - bucket.lastRefill) / 1000; // Convert to seconds
        const newTokens = Math.min(
            bucket.bucketSize,
            bucket.tokens + (timePassed * bucket.refillRate)
        );
        if (process.env.NODE_ENV !== 'production') {
            console.log('[Rate Limiter] Time passed:', timePassed, 'seconds');
            console.log('[Rate Limiter] Tokens before refill:', bucket.tokens);
            console.log('[Rate Limiter] Tokens after refill:', newTokens);
        }
        return newTokens;
    }

    // Check if request is allowed
    async isAllowed(identifier, bucketSize, refillRate) {
        const now = Date.now();
        console.log(`[Rate Limiter] Checking for identifier: ${identifier}`);
        
        const bucket = await this.getBucket(identifier, bucketSize, refillRate);
        console.log(`[Rate Limiter] Current bucket state:`, bucket);
        
        // Calculate tokens to add based on time passed
        const timePassed = (now - bucket.lastRefill) / 1000; // Convert to seconds
        const tokensToAdd = timePassed * bucket.refillRate;
        const newTokens = Math.min(
            bucket.bucketSize,
            bucket.tokens + tokensToAdd
        );
        
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[Rate Limiter] Time passed: ${timePassed.toFixed(3)} seconds`);
            console.log(`[Rate Limiter] Tokens before refill: ${bucket.tokens.toFixed(3)}`);
            console.log(`[Rate Limiter] Tokens to add: ${tokensToAdd.toFixed(3)}`);
            console.log(`[Rate Limiter] Tokens after refill: ${newTokens.toFixed(3)}`);
        }

        // Check if we have enough tokens (at least 1)
        if (newTokens < 1) {
            const timeToNextToken = Math.ceil((1 - newTokens) / bucket.refillRate);
            
            // Only log in non-production environments
            if (process.env.NODE_ENV !== 'production') {
                console.log(`[Rate Limiter] Rate limit exceeded. Retry after: ${timeToNextToken}s`);
            }
            
            // Update the bucket with current time but keep tokens at current level
            // This prevents token accumulation during rate limiting
            const multi = this.redis.multi();
            multi.hmset(this.getKey(identifier), {
                tokens: newTokens,
                lastRefill: now
            });
            multi.expire(this.getKey(identifier), this.keyExpiry);
            await multi.exec();
            
            return {
                allowed: false,
                retryAfter: timeToNextToken,
                remaining: 0
            };
        }

        // We have enough tokens, consume one
        const remainingTokens = newTokens - 1;
        
        // Update bucket with new token count and timestamp
        const multi = this.redis.multi();
        multi.hmset(this.getKey(identifier), {
            tokens: remainingTokens,
            lastRefill: now
        });
        multi.expire(this.getKey(identifier), this.keyExpiry);
        await multi.exec();

        if (process.env.NODE_ENV !== 'production') {
            console.log(`[Rate Limiter] Request allowed. Remaining tokens: ${Math.floor(remainingTokens)}`);
        }
        return {
            allowed: true,
            retryAfter: 0,
            remaining: Math.floor(remainingTokens)
        };
    }
}

// Middleware factory
const createRateLimiter = (options = {}) => {
    const limiter = new TokenBucketLimiter(options);
    
    return async (req, res, next) => {
        // Check if Redis is available, skip rate limiting if not available
        if (!isRedisAvailable()) {
            console.log('[Rate Limiter] Redis not available, skipping rate limiting');
            return next();
        }
        
        try {
            // Get identifier (e.g., user ID or IP)
            const identifier = options.keyGenerator ? 
                options.keyGenerator(req) : 
                req.ip;

            // Get rate limits based on user's plan
            const limits = options.planLimiter ? 
                options.planLimiter(req) : 
                {
                    bucketSize: options.defaultBucketSize || 100,
                    refillRate: options.defaultRefillRate || 10
                };

            if (process.env.NODE_ENV !== 'production') {
                console.log(`[Rate Limiter Debug] Request from ${identifier} with limits: bucket=${limits.bucketSize}, refill=${limits.refillRate}`);
            }

            const result = await limiter.isAllowed(
                identifier,
                limits.bucketSize,
                limits.refillRate
            );
            //after isAlloed success we will proceed further

            // Add rate limit headers
            res.set('X-RateLimit-Remaining', result.remaining);
            res.set('X-RateLimit-Limit', limits.bucketSize);
            
            if (result.retryAfter > 0) {
                res.set('Retry-After', result.retryAfter);
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[Rate Limiter Debug] Rate limited ${identifier}: retry after ${result.retryAfter}s`);
                }
            }

            if (!result.allowed) {
                return res.status(429).json({
                    error: 'Too Many Requests',
                    retryAfter: result.retryAfter
                });
            }

            if (process.env.NODE_ENV !== 'production') {
                console.log(`[Rate Limiter Debug] Request allowed for ${identifier}: ${result.remaining}/${limits.bucketSize} tokens remaining`);
            }
            next();
        } catch (error) {
            console.error(`[Rate Limiter Error] ${error.message}`);
            // If Redis is down or unavailable, follow the failOpen policy
            if (options.failOpen || !isRedisAvailable()) {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[Rate Limiter Debug] Redis error or unavailable but failOpen=${options.failOpen}, allowing request`);
                }
                next();
            } else {
                if (process.env.NODE_ENV !== 'production') {
                    console.log(`[Rate Limiter Debug] Redis error and failOpen=false, rejecting request`);
                }
                next(error);
            }
        }
    };
};

module.exports = createRateLimiter;
module.exports.TokenBucketLimiter = TokenBucketLimiter;