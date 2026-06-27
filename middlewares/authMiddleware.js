const jwt = require('jsonwebtoken');

/**
 * Extracts JWT token from Authorization header or cookie
 */
const extractToken = (req) => {
    // First check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    
    // Fallback to cookie
    if (req.cookies && req.cookies.auth_token) {
        return req.cookies.auth_token;
    }
    
    return null;
};

const verifyToken = (req, res, next) => {
    const token = extractToken(req);
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Access denied. No token provided.' 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid or expired token' 
        });
    }
};

module.exports = { verifyToken, extractToken };