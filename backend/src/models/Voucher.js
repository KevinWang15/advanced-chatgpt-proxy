const { DataTypes } = require("sequelize");
const sequelize = require("../config/database-config");

const Voucher = sequelize.define("Voucher", {
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    primaryKey: true,
  },
  durationDays: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: "Number of days the voucher extends membership",
  },
  isUsed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  usedByUserId: {
    type: DataTypes.STRING, // Corresponds to User.keycloakId
    allowNull: true,
    references: {
      model: "Users", // Name of the table (usually pluralized by Sequelize)
      key: "keycloakId",
    },
  },
  usedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Add other voucher-related fields if needed, e.g., expiry date for the voucher itself
});

module.exports = Voucher;

