const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const path = require('path');
const { logger } = require('../utils/utils');
const config = require(path.join(__dirname, "..", process.env.CONFIG));
const anonymizationService = require('./anonymization');
const { accounts } = require('../state/state');

/**
 * Notify external service about a new deep research activation
 * Silently fails - only logs errors without disrupting main flow
 * @param {Object} researchData - Information about the deep research activation
 */
async function notifyDeepResearchActivation(researchData) {
  try {
    // Prepare notification data
    const notificationData = {
      event_type: 'deep_research_activated',
      async_task_id: researchData.asyncTaskId,
      conversation_id: researchData.conversationId,
      user_access_token: researchData.userAccessToken,
      version: researchData.version,
      timestamp: new Date().toISOString()
    };

    // If there's a webhook URL in the config, use it for notifications
    const webhookUrl = config.centralServer?.deepResearchWebhook || 'https://example.com/webhook';

    // Include the integration API key for authentication
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': config.centralServer?.auth?.integrationApiKey || ''
    };

    // Send the notification - we don't await this and we ignore errors
    axios.post(webhookUrl, notificationData, { headers })
      .then(() => {
        logger.info(`Notified about deep research activation: ${researchData.asyncTaskId}`);
      })
      .catch(error => {
        // Just log errors, don't disrupt the main flow
        logger.error(`Failed to notify about deep research activation: ${error.message}`);
      });

    // Return immediately without waiting for the request to complete
    return true;
  } catch (error) {
    // Log and ignore any errors
    logger.error(`Error in notifyDeepResearchActivation: ${error.message}`);
    return false;
  }
}

/**
 * Check conversation data for deep research status and update both the conversation and deep research tracker
 * This function is used by both the polling mechanism and the live conversation retrieval
 * @param {Object} conversationData - The conversation data from ChatGPT
 * @param {String} conversationId - The conversation ID
 * @param {String} asyncTaskId - The deep research async task ID to look for (optional)
 * @returns {Object} - { status: String, updated: Boolean }
 */
async function processConversationForDeepResearch(conversationData, conversationId, asyncTaskId = null) {
  if (!conversationData || !conversationId) {
    return { status: 'pending', updated: false };
  }

  try {
    const prisma = new PrismaClient();
    let updated = false;
    let status = 'pending';

    // First, update the conversation data in the database
    try {
      await prisma.conversation.update({
        where: {
          id: conversationId
        },
        data: {
          conversationData: conversationData,
          updatedAt: new Date()
        }
      });
      updated = true;
      logger.info(`Updated conversation data for ${conversationId}`);
    } catch (updateError) {
      logger.error(`Error updating conversation data: ${updateError.message}`);
    }

    // If we have an asyncTaskId, check its status and update if needed
    if (asyncTaskId && conversationData.mapping) {
      // Find any deep research tasks in the conversation
      const matchingTasks = [];

      // If asyncTaskId is provided, only check that specific one
      if (asyncTaskId) {
        matchingTasks.push(asyncTaskId);
      } else {
        // Otherwise, look for any deep research tasks in the conversation
        for (const messageId in conversationData.mapping) {
          const message = conversationData.mapping[messageId];
          if (message.message &&
              message.message.metadata &&
              message.message.metadata.async_task_id &&
              message.message.metadata.async_task_id.startsWith('deepresch_')) {
            matchingTasks.push(message.message.metadata.async_task_id);
          }
        }
      }

      // Process each found task
      for (const taskId of matchingTasks) {
        // Check the status for this task
        status = 'pending';

        for (const messageId in conversationData.mapping) {
          const message = conversationData.mapping[messageId];

          if (message.message &&
              message.message.metadata &&
              message.message.metadata.async_task_id === taskId &&
              message.message.metadata.command !== 'start_research_task'
          ) {

            if (message.message.status === 'finished_successfully') {
              status = 'succeeded';
              break;
            } else if (message.message.status === 'error' ||
                      message.message.status === 'failed') {
              status = 'failed';
              break;
            }
          }
        }

        // If the status isn't pending, update the deep research tracker
        if (status !== 'pending') {
          try {
            // Check if this task exists in our tracker
            const existingTask = await prisma.deepResearchTracker.findUnique({
              where: {
                asyncTaskId: taskId
              }
            });

            if (existingTask && existingTask.status === 'pending') {
              // Update the status
              await prisma.deepResearchTracker.update({
                where: {
                  asyncTaskId: taskId
                },
                data: {
                  status: status
                }
              });
              logger.info(`Updated deep research task ${taskId} status to ${status}`);
            }
          } catch (taskError) {
            logger.error(`Error updating deep research task ${taskId}: ${taskError.message}`);
          }
        }
      }
    }

    await prisma.$disconnect();
    return { status, updated };
  } catch (error) {
    logger.error(`Error in processConversationForDeepResearch: ${error.message}`);
    return { status: 'pending', updated: false };
  }
}

/**
 * Update the status of a deep research task
 * @param {string} asyncTaskId - The async_task_id of the deep research task
 * @param {string} status - The new status ('pending', 'timedout', 'failed', 'succeeded')
 */
async function updateDeepResearchStatus(asyncTaskId, status) {
  try {
    const prisma = new PrismaClient();

    // Check if this async_task_id exists
    const existingRecord = await prisma.deepResearchTracker.findUnique({
      where: {
        asyncTaskId: asyncTaskId
      }
    });

    if (existingRecord) {
      // Update the status
      await prisma.deepResearchTracker.update({
        where: {
          asyncTaskId: asyncTaskId
        },
        data: {
          status: status
        }
      });

      logger.info(`Updated deep research task ${asyncTaskId} status to ${status}`);
    }

    await prisma.$disconnect();
  } catch (error) {
    logger.error(`Error in updateDeepResearchStatus: ${error.message}`);
    throw error;
  }
}

/**
 * Get all pending deep research tasks
 * @returns {Promise<Array>} - Array of pending deep research tasks
 */
async function getPendingDeepResearchTasks() {
  try {
    const prisma = new PrismaClient();

    const pendingTasks = await prisma.deepResearchTracker.findMany({
      where: {
        status: 'pending'
      },
      include: {
        // Include any related data you might need
      }
    });

    await prisma.$disconnect();
    return pendingTasks;
  } catch (error) {
    logger.error(`Error in getPendingDeepResearchTasks: ${error.message}`);
    throw error;
  }
}

/**
 * Check conversation for deep research status
 * @param {Object} task - The deep research task to check
 * @returns {Promise<string>} - Status result ('pending', 'timedout', 'failed', 'succeeded')
 */
async function checkDeepResearchConversation(task) {
  try {
    const prisma = new PrismaClient();

    // Get the conversation to find the account name
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: task.conversationId
      }
    });

    if (!conversation) {
      await prisma.$disconnect();
      throw new Error(`Conversation ${task.conversationId} not found`);
    }

    const accountName = conversation.accountName;

    // Get the account details
    if (!accounts[accountName]) {
      await prisma.$disconnect();
      throw new Error(`Account ${accountName} not found`);
    }

    const accessToken = accounts[accountName].accessToken;
    const cookie = accounts[accountName].cookie;
    const proxy = accounts[accountName].proxy;

    // Prepare headers for the request
    const headers = {
      'authorization': `Bearer ${accessToken}`,
      'cookie': `__Secure-next-auth.session-token=${cookie}`,
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    };

    // Prepare proxy configuration
    const axiosConfig = {
      headers: headers,
      proxy: false,
      httpsAgent: new (require('https-proxy-agent').HttpsProxyAgent)(proxy)
    };

    // Make the request to get conversation details
    const response = await axios.get(
      `https://chatgpt.com/backend-api/conversation/${task.conversationId}`,
      axiosConfig
    );

    // Process the conversation data using our helper function
    const result = await processConversationForDeepResearch(
      response.data,
      task.conversationId,
      task.asyncTaskId
    );

    await prisma.$disconnect();
    return result.status;
  } catch (error) {
    logger.error(`Error checking deep research conversation: ${error.message}`);
    return 'pending'; // Assume still pending on error
  }
}

/**
 * Poll for deep research status updates
 */
async function pollDeepResearch() {
  try {
    const prisma = new PrismaClient();

    // Get all pending deep research tasks
    const pendingTasks = await getPendingDeepResearchTasks();

    if (pendingTasks.length > 0) {
      logger.info(`Checking ${pendingTasks.length} pending deep research tasks`);

      // Process each pending task
      for (const task of pendingTasks) {
        try {
          // Check if the task is more than 1 hour old
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

          if (task.createdAt < oneHourAgo) {
            // Task has timed out
            await updateDeepResearchStatus(task.asyncTaskId, 'timedout');
            continue;
          }

          // Check the conversation for task status
          const status = await checkDeepResearchConversation(task);

          // Update the status if it's not pending anymore
          if (status !== 'pending') {
            await updateDeepResearchStatus(task.asyncTaskId, status);
          }
        } catch (taskError) {
          logger.error(`Error processing task ${task.asyncTaskId}: ${taskError.message}`);
        }
      }
    }

    await prisma.$disconnect();
  } catch (error) {
    logger.error(`Error in pollDeepResearch: ${error.message}`);
  } finally {
    // Schedule the next poll after 1 minute
    setTimeout(pollDeepResearch, 60 * 1000);
  }
}

// Export functions for use in other modules
module.exports = {
  updateDeepResearchStatus,
  getPendingDeepResearchTasks,
  checkDeepResearchConversation,
  pollDeepResearch,
  processConversationForDeepResearch,
  notifyDeepResearchActivation
};