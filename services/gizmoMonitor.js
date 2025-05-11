const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { logger } = require('../utils/utils');
const config = require(path.join(__dirname, "..", process.env.CONFIG));
const anonymizationService = require('./anonymization');
const { accounts } = require('../state/state');

/**
 * Process gizmo data and store it in the database
 * @param {Object} gizmoData - The gizmo data from ChatGPT
 * @param {String} gizmoId - The gizmo ID
 * @param {String} userAccessToken - The user's access token
 * @param {String} accountName - The account name that accessed the gizmo
 * @returns {Promise<Object>} - { updated: Boolean }
 */
async function processGizmoData(gizmoData, gizmoId, userAccessToken, accountName) {
  if (!gizmoData || !gizmoId) {
    return { updated: false };
  }

  try {
    const prisma = new PrismaClient();
    let updated = false;

    // Extract useful fields from gizmo data
    const shortUrl = gizmoData.gizmo?.short_url || null;
    const name = gizmoData.gizmo?.display?.name || null;
    const lastInteracted = gizmoData.gizmo?.last_interacted_at ? new Date(gizmoData.gizmo.last_interacted_at) : null;

    try {
      // Check if the gizmo already exists
      const existingGizmo = await prisma.gizmo.findUnique({
        where: { id: gizmoId }
      });

      if (existingGizmo) {
        // Update the existing gizmo
        await prisma.gizmo.update({
          where: { id: gizmoId },
          data: {
            gizmoData: gizmoData,
            shortUrl: shortUrl,
            name: name,
            lastInteracted: lastInteracted,
            updatedAt: new Date()
          }
        });
        updated = true;
        logger.info(`Updated gizmo data for ${gizmoId}`);
      } else {
        // Create a new gizmo record
        await prisma.gizmo.create({
          data: {
            id: gizmoId,
            userAccessToken: userAccessToken,
            accountName: accountName,
            gizmoData: gizmoData,
            shortUrl: shortUrl,
            name: name,
            lastInteracted: lastInteracted
          }
        });
        updated = true;
        logger.info(`Created new gizmo record for ${gizmoId}`);
      }
    } catch (dbError) {
      logger.error(`Error updating/creating gizmo data: ${dbError.message}`);
    }

    await prisma.$disconnect();
    return { updated };
  } catch (error) {
    logger.error(`Error in processGizmoData: ${error.message}`);
    return { updated: false };
  }
}

/**
 * Get gizmo by ID
 * @param {string} gizmoId - The gizmo ID to retrieve
 * @returns {Promise<Object|null>} - The gizmo record or null if not found
 */
async function getGizmoById(gizmoId) {
  try {
    const prisma = new PrismaClient();
    
    const gizmo = await prisma.gizmo.findUnique({
      where: {
        id: gizmoId
      }
    });
    
    await prisma.$disconnect();
    return gizmo;
  } catch (error) {
    logger.error(`Error in getGizmoById: ${error.message}`);
    return null;
  }
}

/**
 * Get all gizmos for a user
 * @param {string} userAccessToken - The user's access token
 * @returns {Promise<Array>} - Array of gizmos for the user
 */
async function getGizmosByUser(userAccessToken) {
  try {
    const prisma = new PrismaClient();
    
    const gizmos = await prisma.gizmo.findMany({
      where: {
        userAccessToken: userAccessToken
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    await prisma.$disconnect();
    return gizmos;
  } catch (error) {
    logger.error(`Error in getGizmosByUser: ${error.message}`);
    return [];
  }
}

/**
 * Get all gizmos for an account
 * @param {string} accountName - The account name
 * @returns {Promise<Array>} - Array of gizmos for the account
 */
async function getGizmosByAccount(accountName) {
  try {
    const prisma = new PrismaClient();
    
    const gizmos = await prisma.gizmo.findMany({
      where: {
        accountName: accountName
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    
    await prisma.$disconnect();
    return gizmos;
  } catch (error) {
    logger.error(`Error in getGizmosByAccount: ${error.message}`);
    return [];
  }
}

// Export functions for use in other modules
module.exports = {
  processGizmoData,
  getGizmoById,
  getGizmosByUser,
  getGizmosByAccount
};