const { keycloak } = require("../config/keycloak-config");
const { findOrCreateUser } = require("./userController"); // Import the sync function

// Controller for Keycloak login
// keycloak.protect() middleware handles the actual redirection to Keycloak login page.
// This endpoint can be called by the frontend to initiate the login flow if needed,
// although accessing any protected route will also trigger it.
exports.login = (req, res) => {
  // If keycloak.protect() is used before this route, the user should already be authenticated.
  // If not protected, calling keycloak.protect() here would initiate login.
  // For simplicity, we assume the frontend directs the user to a protected route or
  // uses a Keycloak client adapter (like keycloak-js) which handles login initiation.
  // This backend endpoint might just return user info if already logged in.
  if (req.kauth && req.kauth.grant) {
    res.json({ message: "Already logged in", user: req.kauth.grant.access_token.content });
  } else {
    // This path might not be reached if middleware protects it.
    // If unprotected, you could manually trigger login:
    // keycloak.protect()(req, res, () => res.redirect("/")); // Or redirect elsewhere
    res.status(401).json({ message: "Not authenticated, access a protected route to login." });
  }
};

// Controller for Keycloak logout
// The keycloak middleware with logout path configured might handle this automatically.
// This provides an explicit API endpoint.
exports.logout = (req, res, next) => {
  // req.logout() is often added by passport/session middleware, not directly by keycloak-connect
  // Keycloak middleware should handle session cleanup based on its config.
  // We can redirect the user to the Keycloak logout URL.
  if (req.kauth && req.kauth.grant) {
    // Clear the local session
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      // Redirect to Keycloak logout URL
      const logoutUrl = keycloak.logoutUrl(process.env.KEYCLOAK_REDIRECT_URI || "http://localhost:3000"); // Redirect back to frontend home
      res.redirect(logoutUrl);
    });
  } else {
    res.redirect(process.env.KEYCLOAK_REDIRECT_URI || "http://localhost:3000"); // Redirect home if not logged in
  }
};

// Controller to get user info from Keycloak token
exports.getUserInfo = async (req, res) => {
  if (req.kauth && req.kauth.grant) {
    const userInfo = req.kauth.grant.access_token.content;
    try {
      // Ensure user exists in local DB upon requesting info
      await findOrCreateUser(userInfo);
      res.json({
        keycloakId: userInfo.sub,
        username: userInfo.preferred_username,
        email: userInfo.email,
        // Add roles or other relevant info from token if needed
        // roles: userInfo.realm_access?.roles,
      });
    } catch (error) {
      console.error("Error during user sync in getUserInfo:", error);
      res.status(500).json({ message: "Failed to process user information" });
    }
  } else {
    res.status(401).json({ message: "Not authenticated" });
  }
};

