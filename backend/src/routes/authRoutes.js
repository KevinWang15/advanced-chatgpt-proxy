const express = require("express");
const authController = require("../controllers/authController");
const { keycloak } = require("../config/keycloak-config");

const router = express.Router();

// Route to initiate login (optional, as accessing protected routes also triggers login)
// If the frontend uses keycloak-js, it might handle login initiation directly.
router.get("/login", keycloak.protect(), authController.login); // Protect to ensure redirect

// Route to handle logout
router.get("/logout", authController.logout);

// Route to get current authenticated user's info (already synced with local DB)
// This route is protected by Keycloak middleware applied in app.js or here
router.get("/user", keycloak.protect(), authController.getUserInfo);

// Callback route for Keycloak after login (often handled by keycloak.middleware)
// Usually, you don't need an explicit callback route if using keycloak.middleware correctly,
// as it intercepts the redirect from Keycloak and establishes the session.
// If needed for specific post-login actions not covered by findOrCreateUser,
// you might define one, but it's often unnecessary.
// router.get("/callback", keycloak.middleware(), (req, res) => {
//   // Post-login logic here, then redirect
//   res.redirect("/"); // Redirect to frontend home or dashboard
// });

module.exports = router;

