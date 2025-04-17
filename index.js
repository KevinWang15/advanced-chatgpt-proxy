const {v4: uuidv4} = require('uuid');
const http = require('http');
const startReverseProxy = require("./services/reverseproxy");
const {addConversationAccess} = require("./services/auth");
const startMitmProxyForBrowser = require("./services/mitmproxy");
const {logger} = require("./utils/utils");
const {Server} = require("socket.io");
const {StopGenerationCallback} = require("./services/reverseproxy_specialhandlers");
const {startChromeWithoutPuppeteer} = require("./services/launch_chrome");
const {getSocketIOServerPort} = require("./state/state");


delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.all_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const socketIoHttpServer = http.createServer();
const io = new Server(socketIoHttpServer, {
    path: "/socket.io/",
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const dynamicNsp = io.of(/^\/.*$/);
(async function () {
    const port = await getSocketIOServerPort();
    socketIoHttpServer.listen(port, "127.0.0.1", () => {
        console.log("SocketIO Server listening on http://127.0.0.1:" + port + " (this server is used for socketio, bi-directional communication between the chrome extension and the main server)");
    });
})()

// Store worker data in a Map keyed by workerId
// Example structure of each entry:
// workers[workerId] = {
//   socket: <Socket>,
//   lastHeartbeat: <Number: Date.now()>,
//   available: <Boolean> - used to see if worker is free to handle new work
//   responseWriter
// }
const workers = {};


const HEARTBEAT_CHECK_INTERVAL = 1000;
const HEARTBEAT_TIMEOUT = 30000;

// Periodically check for dead workers
setInterval(() => {
    const now = Date.now();
    for (const workerId in workers) {
        const data = workers[workerId];
        if (now - data.lastHeartbeat > HEARTBEAT_TIMEOUT) {
            console.log(`Worker ${workerId} timed out. Disconnecting and cleaning up.`);
            data.socket.disconnect(true);
            delete workers[workerId];
        }
    }
}, HEARTBEAT_CHECK_INTERVAL);

async function findAvailableWorker(selectedAccount) {
    const startTime = Date.now();
    const timeout = 10000;

    while (Date.now() - startTime < timeout) {
        for (const workerId in workers) {
            const data = workers[workerId];
            if (data.available && data.accountName === selectedAccount.name) {
                return workerId;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return null;
}

function doWork(task, req, res, selectedAccount, {retryCount = 0} = {}) {
    return new Promise(async (resolve, reject) => {
        const workerId = await findAvailableWorker(selectedAccount);
        if (!workerId) {
            reject(new Error("No available workers; please copy your prompt, refresh the page, and send again"));
            return;
        }

        const workerData = workers[workerId];
        const socket = workerData.socket;
        workerData.available = false;

        let ackTimeout = null;

        const handleAck = () => {
            console.log(`Worker ${workerId} acknowledged work.`);

            // Clear the ack timeout
            clearTimeout(ackTimeout);

            // If worker disconnects before finishing
            const handleDisconnect = () => {
                cleanupListeners();
                resolve();
            };

            const cleanupListeners = () => {
                socket.off("disconnect", handleDisconnect);
                socket.off("ackWork", handleAck);
            };

            // Listen for events
            socket.once("disconnect", handleDisconnect);
        };

        // If worker fails to ack within 2 seconds, remove it and try again
        ackTimeout = setTimeout(() => {
            console.log(`Worker ${workerId} failed to ack. Disconnecting and retrying...`);
            socket.disconnect(true);
            delete workers[workerId];

            // Attempt to do work again
            if (retryCount < 3) {
                doWork(task, res, selectedAccount, {retryCount: retryCount + 1}).then(resolve).catch(reject);
            } else {
                reject(new Error("Maximum retries reached"));
            }
        }, 2000);

        // Listen for ack
        socket.once("ackWork", handleAck);
        socket.once("sendConversationHeader", ({status, header}) => {
            try {
                res.writeHead(status, header);
            } catch (e) {
                console.warn(e);
            }

        });

        // Send the assignment
        console.log(`Assigning work to worker ${workerId}`, selectedAccount);
        workers[workerId].responseWriter = res;
        workers[workerId].accessToken = selectedAccount.accessToken;
        workers[workerId].userAccessToken = req.cookies?.access_token;

        socket.emit("assignWork", {task});
    });
}

// Socket.io connection handler
dynamicNsp.on("connection", (socket) => {
    // The worker should send us its workerId right away (e.g. in handshake or first event).
    // We'll assume the client is sending the workerId in the query string or first message.
    const {workerId, accountName} = socket.handshake.query;

    if (!workerId) {
        console.log("A connection was made without a workerId. Disconnecting...");
        return socket.disconnect(true);
    }

    console.log(`Worker ${workerId} (${accountName}) connected.`);
    workers[workerId] = {
        socket,
        accountName,
        lastHeartbeat: Date.now(),
        available: true,
    };

    // Listen for heartbeat
    socket.on("heartbeat", () => {
        // Update last heartbeat
        const workerData = workers[workerId];
        if (workerData) {
            workerData.lastHeartbeat = Date.now();
            // Reply with "pong"
            socket.emit("pong");
        }
    });

    // When the socket disconnects
    socket.on("disconnect", () => {
        console.log(`Worker ${workerId} disconnected. Cleaning up.`);
        if (workers[workerId] && workers[workerId].responseWriter && !workers[workerId].responseWriter.headersSent) {
            workers[workerId].responseWriter.writeHead(500, {'Content-Type': 'application/json'});
            workers[workerId].responseWriter.end(JSON.stringify({error: 'Worker disconnected unexpectedly. Please copy your prompt, refresh the page, and try again.'}));
        }
        delete workers[workerId];
    });


    socket.on("network", (data) => {
        handleNetwork({...data, workerId: workerId}, socket);
    });
});


// Handle network messages
function handleNetwork(data, socket) {
    const {workerId, url, text, isDone} = data;
    if (!workerId || !url) {
        return;
    }

    // Verify worker and request are valid
    if (!workers[workerId]) {
        return;
    }

    // Check if the URL matches the expected URL
    if (url.replace('backend-alt', 'backend-api') !== "https://chatgpt.com/backend-api/conversation") {
        return;
    }

    try {
        if (isDone) {
            // Complete the response
            workers[workerId].responseWriter.end();
        } else {
            // Extract conversation ID if present and add access
            // TODO: security vulnerability here
            if (text.indexOf('"conversation_id": "') >= 0) {
                try {
                    const conversationId = text.match(/"conversation_id":\s*"([a-f0-9-]+)"/)[1];
                    addConversationAccess(conversationId, workers[workerId].userAccessToken);


                    StopGenerationCallback[conversationId] = () => {
                        socket.emit("stopGeneration");
                    }
                    setTimeout(() => { // cleanup after 1 hour
                        if (StopGenerationCallback[conversationId]) {
                            delete StopGenerationCallback[conversationId];
                        }
                    }, 60 * 60 * 1000);
                } catch (error) {
                    logger.error(`Error extracting conversation ID: ${error.message}`);
                }
            }

            // Write chunk to response
            workers[workerId].responseWriter.write(text);
        }
    } catch (error) {
        logger.error(`Error handling network message: ${error.message}`);
        // Clean up on error
        if (workers[workerId].responseWriter) {
            try {
                if (!workers[workerId].responseWriter.writableEnded) {
                    workers[workerId].responseWriter.end();
                }
            } catch (err) {
                logger.error(`Error ending response: ${err.message}`);
            }
        }
    }
}


startReverseProxy({doWork});
setTimeout(() => {
    startMitmProxyForBrowser();
    setTimeout(() => {
        startChromeWithoutPuppeteer();
    }, 1000);
}, 1000);
