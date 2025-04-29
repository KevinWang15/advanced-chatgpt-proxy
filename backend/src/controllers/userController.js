const User = require("../models/User");

// Function to find or create a user in the local database based on Keycloak info
// This should be called after successful Keycloak authentication
exports.findOrCreateUser = async (keycloakUser) => {
  if (!keycloakUser || !keycloakUser.sub) {
    console.error("Invalid Keycloak user data provided for findOrCreateUser");
    return null;
  }

  try {
    let user = await User.findByPk(keycloakUser.sub);

    if (!user) {
      console.log(`User with Keycloak ID ${keycloakUser.sub} not found locally. Creating...`);
      user = await User.create({
        keycloakId: keycloakUser.sub,
        username: keycloakUser.preferred_username,
        email: keycloakUser.email,
        // Initialize membershipExpiresAt to null or a default value if applicable
        membershipExpiresAt: null, 
      });
      console.log(`User ${user.username} created successfully.`);
    } else {
      // Optionally update user info if it changed in Keycloak
      if (user.username !== keycloakUser.preferred_username || user.email !== keycloakUser.email) {
        console.log(`Updating local user info for Keycloak ID ${keycloakUser.sub}`);
        await User.update({
          username: keycloakUser.preferred_username,
          email: keycloakUser.email,
        }, {
          where: { keycloakId: keycloakUser.sub }
        });
        // Re-fetch user data after update if needed, or merge changes
        user.username = keycloakUser.preferred_username;
        user.email = keycloakUser.email;
      }
    }
    return user;
  } catch (error) {
    console.error("Error finding or creating user:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
};

// Controller to get current user's profile (including membership)
exports.getCurrentUserProfile = async (req, res) => {
  const keycloakId = req.kauth?.grant?.access_token?.content?.sub;

  if (!keycloakId) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  try {
    // Ensure user exists locally (findOrCreate might be better placed in middleware)
    const keycloakUserInfo = req.kauth.grant.access_token.content;
    const user = await exports.findOrCreateUser(keycloakUserInfo);

    if (!user) {
      // This should ideally not happen if findOrCreateUser is called correctly
      return res.status(500).json({ message: "Failed to retrieve or create user profile" });
    }

    const isMember = user.membershipExpiresAt && user.membershipExpiresAt > new Date();

    res.json({
      keycloakId: user.keycloakId,
      username: user.username,
      email: user.email,
      isMember: isMember,
      membershipExpiresAt: user.membershipExpiresAt,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
};

