const User = require("../models/User");
const Voucher = require("../models/Voucher");
const { Op } = require("sequelize");

// Controller to get membership status (including expiration)
exports.getMembershipStatus = async (req, res) => {
  // Keycloak user ID should be available from the token after Keycloak integration
  // For now, we might need a placeholder or pass it in the request for testing
  const keycloakId = req.kauth?.grant?.access_token?.content?.sub; // Access Keycloak user ID

  if (!keycloakId) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  try {
    const user = await User.findByPk(keycloakId);

    if (!user) {
      // This case might happen if the user exists in Keycloak but not yet in our DB
      // We might need a user sync mechanism upon first login
      return res.status(404).json({ message: "User not found in local database" });
    }

    const isMember = user.membershipExpiresAt && user.membershipExpiresAt > new Date();

    res.json({
      isMember: isMember,
      expiresAt: user.membershipExpiresAt,
      // Add other relevant membership details if needed
    });
  } catch (error) {
    console.error("Error fetching membership status:", error);
    res.status(500).json({ message: "Failed to fetch membership status" });
  }
};

// Controller to redeem a voucher
exports.redeemVoucher = async (req, res) => {
  const keycloakId = req.kauth?.grant?.access_token?.content?.sub;
  const { voucherCode } = req.body;

  if (!keycloakId) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  if (!voucherCode) {
    return res.status(400).json({ message: "Voucher code is required" });
  }

  try {
    const user = await User.findByPk(keycloakId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const voucher = await Voucher.findOne({
      where: {
        code: voucherCode,
        isUsed: false,
        // Optional: Add voucher expiry check if vouchers themselves expire
        // expiryDate: { [Op.gt]: new Date() }
      },
    });

    if (!voucher) {
      return res.status(404).json({ message: "Voucher not found, already used, or expired" });
    }

    // Calculate new expiration date
    const currentExpiration = user.membershipExpiresAt && user.membershipExpiresAt > new Date() ? user.membershipExpiresAt : new Date();
    const newExpirationDate = new Date(currentExpiration);
    newExpirationDate.setDate(newExpirationDate.getDate() + voucher.durationDays);

    // Update user and voucher in a transaction
    await sequelize.transaction(async (t) => {
      await User.update(
        { membershipExpiresAt: newExpirationDate },
        { where: { keycloakId: keycloakId }, transaction: t }
      );

      await Voucher.update(
        { isUsed: true, usedByUserId: keycloakId, usedAt: new Date() },
        { where: { code: voucherCode }, transaction: t }
      );
    });

    res.json({
      message: "Voucher redeemed successfully",
      newExpirationDate: newExpirationDate,
    });
  } catch (error) {
    console.error("Error redeeming voucher:", error);
    res.status(500).json({ message: "Failed to redeem voucher" });
  }
};

