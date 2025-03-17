const { verifyToken } = require('./auth');

async function authMiddleware(req, res, next) {
    // Skip authentication for the start endpoint and worker registration
    if (req.path === '/start' || req.path === '/register-worker' || 
        req.path === '/ws' || req.url.startsWith('/ws?')) {
        return next();
    }

    const token = req.cookies?.auth_token;
    
    try {
        const isValid = await verifyToken(token);
        if (isValid) {
            return next();
        }
        
        // If no valid token, return 403 Forbidden
        res.status(403).json({ error: 'Authentication required' });
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = authMiddleware;