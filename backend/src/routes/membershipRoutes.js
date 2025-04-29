const express = require("express");
const membershipController = require("../controllers/membershipController");
const { keycloak } = require("../config/keycloak-config"); // Import keycloak instance

const router = express.Router();

// Apply Keycloak protection to all routes in this file
router.use(keycloak.protect());

// Route to get current user's membership status
router.get("/status", membershipController.getMembershipStatus);

// Route to redeem a voucher
router.post("/redeem", membershipController.redeemVoucher);

module.exports = router;

