const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Validates GitHub webhook signature
 * @param {Object} headers - Request headers
 * @param {Object} body - Request body
 * @returns {boolean} - Whether signature is valid
 */
function validateWebhook(headers, body) {
    const signature = headers['x-hub-signature-256'] || headers['x-hub-signature'];
    if (!signature) {
        return false;
    }

    const [algo, hash] = signature.split('=');
    const computedHash = crypto
        .createHmac(algo === 'sha256' ? 'sha256' : 'sha1', WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(computedHash, 'hex'),
        Buffer.from(hash, 'hex')
    );
}

/**
 * Express middleware for webhook validation
 */
function validateWebhookMiddleware(req, res, next) {
    if (!validateWebhook(req.headers, req.body)) {
        return res.status(401).json({
            success: false,
            message: 'Invalid webhook signature'
        });
    }
    next();
}

module.exports = { validateWebhook, validateWebhookMiddleware };