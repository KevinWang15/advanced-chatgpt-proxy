/**
 * Authentication Middleware
 * Protects routes from unauthorized access
 */
const authMiddleware = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    // User is authenticated, proceed to the next middleware
    return next();
  } else {
    // User is not authenticated, redirect to login page
    return res.redirect('/');
  }
};

module.exports = authMiddleware;
