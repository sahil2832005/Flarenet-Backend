const express = require("express");
const { chatbotController } = require("../utils/features/chatBotController");
const router = express.Router();
const createRateLimiter = require("../middlewares/tokenBucketLimiter");
const { verifyToken } = require("../middlewares/authMiddleware");

// Rate limiter configuration for chat endpoint

const chatRateLimiter = createRateLimiter({
    defaultBucketSize: 10,        // Default bucket size
    defaultRefillRate: 0.1,      // 1 token per 10 seconds
    keyGenerator: (req) => {
        // Use API key if available, otherwise normalize IP
        const identifier = req.headers['x-api-key'] || 
               (req.ip.startsWith('::ffff:') ? req.ip.substring(7) : req.ip);
        console.log(`Using identifier: ${identifier} for rate limiting`);
        return identifier;
    },
    planLimiter: (req) => {
        // Example: Different limits based on user plan
        const userPlan = req.body?.plan || 'free';
        const limits = {
            free: { bucketSize: 10, refillRate: 0.1 },     // 10 requests, refills 1 per 10 sec
            pro: { bucketSize: 30, refillRate: 0.5 },     // 30 requests, refills 1 per 2 sec
            enterprise: { bucketSize: 60, refillRate: 1 } // 60 requests, refills 1 per sec
        };
        console.log(`user plan is ${userPlan} with bucketSize: ${limits[userPlan].bucketSize}, refillRate: ${limits[userPlan].refillRate}`);
        return limits[userPlan] || limits.free;
    },
    failOpen: false // Don't allow requests if Redis is down - better for testing
});

router.post("/chat", verifyToken, chatRateLimiter, chatbotController);

module.exports = router;