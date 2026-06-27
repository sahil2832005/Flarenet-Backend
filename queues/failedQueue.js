const { Queue } = require('bullmq');
const Redis = require('ioredis');

// Only log in development
if (process.env.NODE_ENV !== 'production') {
    console.log('failedQueue: Redis configured:', process.env.REDIS_URL ? 'YES' : 'NO');
}

// Create Redis connection for BullMQ
const getRedisConnection = () => {
    if (process.env.REDIS_URL) {
        return new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false
        });
    }
    return new Redis({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    });
};

// Create the failed queue with the connection configuration
const failedQueue = new Queue('failedQueue', {
    connection: getRedisConnection()
});

module.exports = failedQueue;