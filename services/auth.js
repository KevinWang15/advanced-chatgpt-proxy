const crypto = require('crypto');
const path = require('path');
const {v4: uuidv4} = require('uuid');
const axios = require('axios');
const config = require(path.join(__dirname, "..", process.env.CONFIG || "config.centralserver.js"));
const {PrismaClient} = require('@prisma/client');

const prisma = new PrismaClient();
const internalAuthenticationToken = uuidv4();

function getInternalAuthenticationToken() {
    return internalAuthenticationToken;
}

function verifyIntegrationApiKey(apiKey) {
    // Get the integration API key from config
    const configApiKey = config.centralServer.auth.integrationApiKey;
    return apiKey === configApiKey && !!configApiKey;
}

// Generate a secure random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Save a token to the database
async function saveToken(token, webhookUrl = null, isManaged = 0) {
    try {
        const result = await prisma.token.create({
            data: {
                token,
                webhookUrl,
                isManaged: isManaged === 1
            }
        });
        return result.token;
    } catch (error) {
        console.error(`Error saving token: ${error.message}`);
    }
}

// Verify if a token exists in the database
async function verifyToken(token) {
    if (!token) {
        return false;
    }

    try {
        const tokenRecord = await prisma.token.findUnique({
            where: {
                token
            }
        });
        return !!tokenRecord;
    } catch (error) {
        throw error;
    }
}

// Get token information including webhook URL
async function getTokenInfo(token) {
    if (!token) {
        return null;
    }

    try {
        const tokenRecord = await prisma.token.findUnique({
            where: {
                token
            }
        });
        return tokenRecord;
    } catch (error) {
        throw error;
    }
}

/**
 * Call the webhook URL for a managed user
 * @param {string} token - The token of the managed user
 * @param {string} operation - The operation being performed (e.g., 'conversation_start', 'conversation_access')
 * @param {object} data - Data related to the operation
 * @param {object} headers - Optional headers to include in the request
 * @returns {Promise<{allowed: boolean, reason?: string}>} - Whether the operation is allowed and optional reason
 */
async function callWebhook(token, operation, data, headers) {
    try {
        const tokenInfo = await getTokenInfo(token);

        // If not a managed user or no webhook URL, default to allowed
        if (!tokenInfo || !tokenInfo.isManaged || !tokenInfo.webhookUrl) {
            return {allowed: true};
        }

        // Call the webhook URL
        const response = await axios.post(tokenInfo.webhookUrl, {
            token: token,
            operation: operation,
            timestamp: Date.now(),
            data: data
        }, {
            headers: {
                'Content-Type': 'application/json',
                ...(headers || {})
            },
            timeout: 5000 // 5 second timeout
        });

        // Check if the operation is allowed
        if (response.data && typeof response.data.allowed === 'boolean') {
            return {
                allowed: response.data.allowed,
                reason: response.data.reason || null
            };
        }

        // Default to allowed if the response doesn't include an 'allowed' field
        return {allowed: true};
    } catch (error) {
        console.error(`Error calling webhook for token ${token.substring(0, 8)}...: ${error.message}`);
        // Default to allowed if the webhook call fails
        return {allowed: false, reason: 'Webhook call failed'};
    }
}

// Conversation Access Functions
async function checkConversationAccess(conversationId, token, requiredAccessType = null) {
    if (!token) { // x-internal-authentication
        return true;
    }

    if (!token || !conversationId) {
        return false;
    }

    try {
        // Build the query based on whether we need to check for a specific access type
        const query = {
            where: {
                token_conversationId: {
                    token,
                    conversationId
                }
            }
        };

        if (requiredAccessType) {
            query.where.accessType = requiredAccessType;
        }

        const access = await prisma.conversationAccess.findUnique(query);
        return !!access;
    } catch (error) {
        throw error;
    }
}

async function addConversationAccess(conversationId, token, accessType = 'owner') {
    if (!token) { // x-internal-authentication
        return true;
    }

    try {
        // First, check if the conversation_id already exists with a different token
        const existingAccess = await prisma.conversationAccess.findFirst({
            where: {
                conversationId
            }
        });

        if (existingAccess && existingAccess.token !== token) {
            throw new Error(
                'Access to this conversation cannot be granted. A different user already has access.'
            );
        }

        // If no conflicting token, insert or replace access record
        const result = await prisma.conversationAccess.upsert({
            where: {
                token_conversationId: {
                    token,
                    conversationId
                }
            },
            update: {
                accessType,
                createdAt: new Date()
            },
            create: {
                token,
                conversationId,
                accessType
            }
        });

        return true;
    } catch (error) {
        console.error(`Error upserting conversation access to ${token}: ${error.message}`);
    }
}

async function listUserConversations(token) {
    if (!token) {
        return [];
    }

    try {
        const conversations = await prisma.conversationAccess.findMany({
            where: {
                token
            },
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                conversationId: true,
                accessType: true
            }
        });

        return conversations;
    } catch (error) {
        throw error;
    }
}

async function removeConversationAccess(conversationId, token) {
    try {
        const result = await prisma.conversationAccess.delete({
            where: {
                token_conversationId: {
                    token,
                    conversationId
                }
            }
        });

        return result !== null;
    } catch (error) {
        return false; // Record not found or other error
    }
}

// Gizmo Access Functions
async function checkGizmoAccess(gizmoId, token, requiredAccessType = null) {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_GIZMO_ISOLATION) {
        return true;
    }

    if (!token || !gizmoId) {
        return false;
    }

    try {
        // Build the query based on whether we need to check for a specific access type
        const query = {
            where: {
                token_gizmoId: {
                    token,
                    gizmoId
                }
            }
        };

        if (requiredAccessType) {
            query.where.accessType = requiredAccessType;
        }

        const access = await prisma.gizmoAccess.findUnique(query);
        return !!access;
    } catch (error) {
        throw error;
    }
}

async function addGizmoAccess(gizmoId, token, accessType = 'owner') {
    if (!token) { // x-internal-authentication
        return true;
    }
    if (process.env.NO_GIZMO_ISOLATION) {
        return true;
    }

    try {
        // First, check if the gizmo_id already exists with a different token and owner access
        const existingAccess = await prisma.gizmoAccess.findFirst({
            where: {
                gizmoId,
                accessType: 'owner'
            }
        });

        if (existingAccess && existingAccess.token !== token && accessType === 'owner') {
            throw new Error(
                'Ownership of this gizmo cannot be granted. A different user already owns it.'
            );
        }

        // If no conflicting token, insert or replace access record
        const result = await prisma.gizmoAccess.upsert({
            where: {
                token_gizmoId: {
                    token,
                    gizmoId
                }
            },
            update: {
                accessType,
                createdAt: new Date()
            },
            create: {
                token,
                gizmoId,
                accessType
            }
        });

        return true;
    } catch (error) {
        console.error(`Error upserting gizmo access to ${token}: ${error.message}`);
    }
}

async function listUserGizmos(token) {
    if (!token) {
        return [];
    }

    try {
        const gizmos = await prisma.gizmoAccess.findMany({
            where: {
                token
            },
            orderBy: {
                createdAt: 'desc'
            },
            select: {
                gizmoId: true,
                accessType: true
            }
        });

        return gizmos;
    } catch (error) {
        throw error;
    }
}

async function removeGizmoAccess(gizmoId, token) {
    try {
        const result = await prisma.gizmoAccess.delete({
            where: {
                token_gizmoId: {
                    token,
                    gizmoId
                }
            }
        });

        return result !== null;
    } catch (error) {
        return false; // Record not found or other error
    }
}

module.exports = {
    generateToken,
    saveToken,
    verifyToken,
    getTokenInfo,
    verifyIntegrationApiKey,
    callWebhook,

    // Conversation access functions
    checkConversationAccess,
    addConversationAccess,
    listUserConversations,
    removeConversationAccess,

    // Gizmo access functions
    checkGizmoAccess,
    addGizmoAccess,
    listUserGizmos,
    removeGizmoAccess,

    getInternalAuthenticationToken
};