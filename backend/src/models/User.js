const { DataTypes } = require("sequelize");
const sequelize = require("../config/database-config");

const User = sequelize.define("User", {
  keycloakId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    primaryKey: true, // Use Keycloak ID as primary key
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
    },
  },
  membershipExpiresAt: {
    type: DataTypes.DATE,
    allowNull: true, // Can be null if not a member or expired
  },
  // Add other user-related fields if needed
});

module.exports = User;

