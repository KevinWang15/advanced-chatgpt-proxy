if (!process.env.CONFIG) {
    console.error("CONFIG environment variable is not set. Please set it to the path of your config file.");
    process.exit(1);
}

const http = require('http');
const {startReverseProxy} = require("./services/reverseproxy");
const {addConversationAccess} = require("./services/auth");
const startMitmProxyForBrowser = require("./services/mitmproxy");
const {logger} = require("./utils/utils");
const {Server} = require("socket.io");
const {StopGenerationCallback} = require("./services/reverseproxy_specialhandlers");
const {startAllWithChrome, startAllWithAdsPower} = require("./services/launch_browser");
const {
    workers,
    accounts,
    getSocketIOServerPort,
    purgeWorker,
} = require("./state/state");
const path = require("path");
const config = require(path.join(__dirname, process.env.CONFIG));
const {
    accountStatusMap,
    handleMetrics,
    performDegradationCheckForAccount, scheduleInitialCheckForAccount,
} = require("./degradation");
const {startAdminConsole} = require("./admin/main");


// Determine if this is a central server or a worker
const isCentralServer = config.centralServer;
if (isCentralServer) {
    logger.info("Starting as CENTRAL SERVER");
} else {
    logger.info(`Starting as WORKER, connecting to central server: ${config.worker.centralServer}`);
    if (config.adminConsole) {
        startAdminConsole(config);
    }
}

delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.all_proxy;
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.ALL_PROXY;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

// Create Socket.IO server
const socketIoHttpServer = http.createServer();
const io = new Server(socketIoHttpServer, {
    path: "/socket.io/",
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const dynamicNsp = io.of(/^\/.*$/);

// Initialize and start Socket.IO server
(async function () {
    if (isCentralServer) {
        const port = await getSocketIOServerPort();
        // Central server listens on configured port
        const host = config.centralServer.host || "127.0.0.1";
        socketIoHttpServer.listen(port, host, () => {
            logger.info(`Central Server SocketIO listening on http://${host}:${port}`);
        });
    }
})()

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
        };

        // If worker fails to ack within 2 seconds, remove it and try again
        ackTimeout = setTimeout(() => {
            console.log(`Worker ${workerId} failed to ack. Disconnecting and retrying...`);
            socket.disconnect(true);
            purgeWorker(workerId);

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
// Configure Socket.io server options
io.engine.pingTimeout = 60000; // How long to wait for a ping response (ms)
io.engine.pingInterval = 10000; // How often to ping clients (ms)

dynamicNsp.on("connection", (socket) => {
    // Get worker info from handshake query
    const {workerId} = socket.handshake.query;

    const {account} = socket.handshake.auth;

    if (!accountStatusMap[account.name]) {
        accountStatusMap[account.name] = {
            lastDegradationResult: null,
            lastCheckTime: null,
        };
    }

    if (!workerId) {
        console.log("A connection was made without a workerId. Disconnecting...");
        return socket.disconnect(true);
    }

    if (!account?.name) {
        console.log("A connection was made without an accountName. Disconnecting...");
        return socket.disconnect(true);
    }

    console.log(`Worker ${workerId} (${account.name}) connected.`);

    // Store worker with account info
    workers[workerId] = {
        socket,
        accountName: account.name,
        available: true,
    };

    accounts[account.name] = account;

    //  Normal disconnect handling
    socket.on("disconnect", (reason) => {
        console.log(`Worker ${workerId} disconnected (${reason})`);
        if (workers[workerId] && workers[workerId].responseWriter && !workers[workerId].responseWriter.headersSent) {
            workers[workerId].responseWriter.writeHead(500, {'Content-Type': 'application/json'});
            workers[workerId].responseWriter.end(JSON.stringify({error: 'Worker disconnected unexpectedly. Please copy your prompt, refresh the page, and try again.'}));
        }
        purgeWorker(workerId);
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

if (config.worker) {
    // worker mode
} else {
    // central server mode
    startReverseProxy({doWork, handleMetrics, performDegradationCheckForAccount});
}