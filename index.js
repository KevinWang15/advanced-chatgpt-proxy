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
const startMitmProxyForBrowser = require("./services/mitmproxy");

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

    console.log(`WebSocket connection established for worker ${workerId}`);

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
            console.error('Error handling WebSocket message:', error);
        }
    });

    // Handle WebSocket close
    ws.on('close', () => {
        console.log(`WebSocket connection closed for worker ${workerId}`);
        delete sockets[workerId];
    });
});


// Handle network messages
function handleNetwork(data) {
    const {workerId, url, text, isDone} = data;
    if (!workerId || !url) {
        return;
    }

    // Verify worker and request are valid
    if (!workers[workerId] || !responseHandlers[workerId]) {
        return;
    }

    // Update last seen timestamp
    workers[workerId].lastSeen = Date.now();

    // Check if the URL matches the expected URL
    if (url.replace('backend-alt', 'backend-api') !== responseHandlers[workerId].expectedUrl) {
        return;
    }

    if (isDone) {
        responseHandlers[workerId].res.end();
        delete responseHandlers[workerId];
        // TODO: now workers are one-use only; after a single request, they will refresh and register as new worker
        //   this is to avoid chatgpt ui's cache problems which mess things up
        //   we should refactor the code to better handle this new way of using worker
        // TODO2: not all jobs are one-use only, if it is a fetch job then we can reuse it fine,
        //   but for generation-related it is one-use only. So we should further distinguish and configure this.

        // workers[workerId].busy = false;
    } else {
        // TODO: security vulnerability here
        if (text.indexOf('"conversation_id": "') >= 0) {
            const conversationId = text.match(/"conversation_id":\s*"([a-f0-9-]+)"/)[1];
            addConversationAccess(conversationId, responseHandlers[workerId].authToken);
        }
        responseHandlers[workerId].res.write(text);
    }
}

// Worker registration endpoint
app.post('/register-worker', (req, res) => {
    const workerId = uuidv4();
    workers[workerId] = {
        id: workerId,
        lastSeen: Date.now(),
        busy: false
    };

    console.log(`Worker ${workerId} registered`);
    res.json({workerId});
});

// Start the server
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`WebSocket server running at ws://localhost:${port}/ws`);
});

startReverseProxy();
startMitmProxyForBrowser();