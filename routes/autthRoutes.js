const express = require('express');
const { registerUser, loginUser } = require('../auth/userAuth');
const createRateLimiter = require('../middlewares/tokenBucketLimiter');

const router = express.Router();

// Rate limiter for auth endpoints - prevents brute-force attacks
const authRateLimiter = createRateLimiter({
    defaultBucketSize: 5,        // 5 attempts allowed
    defaultRefillRate: 0.1,      // 1 token per 10 seconds
    keyGenerator: (req) => {
        // Use IP address for rate limiting
        const ip = req.ip.startsWith('::ffff:') ? req.ip.substring(7) : req.ip;
        return `auth:${ip}`;
    },
    failOpen: false
});

// Route for user registration
router.post("/register", authRateLimiter, registerUser);

// Route for user login
router.post("/login", authRateLimiter, loginUser);

module.exports = router;