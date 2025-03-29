const express = require('express');
const cors = require('cors');
const {v4: uuidv4} = require('uuid');
const app = express();
const port = 8234;
const WebSocket = require('ws');
const http = require('http');
const startReverseProxy = require("./services/reverseproxy");
const {
    workers,
    responseHandlers,
    sockets
} = require("./state/state");
const {addConversationAccess} = require("./services/auth");
const {unregisterWorker} = require("./services/worker");
const startMitmProxyForBrowser = require("./services/mitmproxy");
const {logger} = require("./utils/utils");

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({server});

// Middleware
app.use(express.json({limit: '50mb'}));
app.use(cors());

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const workerId = urlParams.get('workerId');

    if (!workerId || !workers[workerId]) {
        ws.close();
        return;
    }

    logger.info(`WebSocket connection established for worker ${workerId}`);

    // Store the WebSocket connection
    sockets[workerId] = ws;

    // Handle messages from workers
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'network') {
                handleNetwork(data);
            }
        } catch (error) {
            logger.error('Error handling WebSocket message:', error);
        }
    });

    // Handle WebSocket close
    ws.on('close', () => {
        logger.info(`WebSocket connection closed for worker ${workerId}`);
        unregisterWorker(workerId);
    });

    // Handle WebSocket errors
    ws.on('error', (error) => {
        logger.error(`WebSocket error for worker ${workerId}: ${error.message}`);
        unregisterWorker(workerId);
    });
});


// Handle network messages
function handleNetwork(data) {
    const {workerId, url, text, isDone} = data;
    if (!workerId || !url) {
        return;
    }

    // Verify worker and request are valid
    if (!workers[workerId]) {
        return;
    }

    // No one is listening for this worker, skip
    if (!responseHandlers[workerId]) {
        return;
    }

    // Update last seen timestamp
    workers[workerId].lastSeen = Date.now();

    // Check if the URL matches the expected URL
    if (url.replace('backend-alt', 'backend-api') !== responseHandlers[workerId].expectedUrl) {
        return;
    }

    try {
        if (isDone) {
            // Complete the response
            responseHandlers[workerId].res.end();
            delete responseHandlers[workerId];
        } else {
            // Extract conversation ID if present and add access
            // TODO: security vulnerability here
            if (text.indexOf('"conversation_id": "') >= 0) {
                try {
                    const conversationId = text.match(/"conversation_id":\s*"([a-f0-9-]+)"/)[1];
                    addConversationAccess(conversationId, responseHandlers[workerId].authToken)
                        .catch(err => logger.error(`Failed to add conversation access: ${err.message}`));
                } catch (error) {
                    logger.error(`Error extracting conversation ID: ${error.message}`);
                }
            }

            // Write chunk to response
            responseHandlers[workerId].res.write(text);
        }
    } catch (error) {
        logger.error(`Error handling network message: ${error.message}`);
        // Clean up on error
        if (responseHandlers[workerId]) {
            try {
                if (!responseHandlers[workerId].res.writableEnded) {
                    responseHandlers[workerId].res.end();
                }
            } catch (err) {
                logger.error(`Error ending response: ${err.message}`);
            }
            delete responseHandlers[workerId];
        }
    }
}

// Worker registration endpoint
app.post('/register-worker', (req, res) => {
    const workerId = uuidv4();
    workers[workerId] = {
        id: workerId,
        lastSeen: Date.now()
    };

    logger.info(`Worker ${workerId} registered`);
    res.json({workerId});
});

// Worker unregistration endpoint
app.post('/unregister-worker', (req, res) => {
    const {workerId} = req.body;

    if (!workerId) {
        return res.status(400).json({error: 'Worker ID is required'});
    }

    const result = unregisterWorker(workerId);

    if (result.error) {
        return res.status(404).json({error: result.error});
    }

    res.json({success: true});
});

// Start the server
server.listen(port, () => {
    logger.info(`Server running at http://localhost:${port}`);
    logger.info(`WebSocket server running at ws://localhost:${port}/ws`);
});

startReverseProxy();
startMitmProxyForBrowser();