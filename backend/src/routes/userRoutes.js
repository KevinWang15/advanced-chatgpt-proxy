const express = require("express");
const userController = require("../controllers/userController");
const { keycloak } = require("../config/keycloak-config"); // Import keycloak instance

const router = express.Router();

// Apply Keycloak protection to all routes in this file
router.use(keycloak.protect());

// Route to get current user's profile
// This implicitly uses the findOrCreateUser logic within the controller
router.get("/profile", userController.getCurrentUserProfile);

// Add other user-related routes here if needed

module.exports = router;

