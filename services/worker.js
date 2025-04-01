const {
    workers,
    responseHandlers,
    sockets, pendingTasks
} = require("../state/state");
const {v4: uuidv4} = require("uuid");
const {logger} = require("../utils/utils");

// Function to assign a task to a worker
function assignTaskToWorker(task, res, authToken, retryCount = 0) {
    // 1. Gather available workers
    const availableWorkers = Object.keys(sockets)
        .filter(workerId => workers[workerId] && !responseHandlers[workerId]);

    if (availableWorkers.length === 0) {
        return {
            error: 'No workers available. Please copy your prompt for later reuse, then refresh the page. Don\'t use the retry button, as the original prompt was never sent to the server, so retrying won\'t work.',
            status: 503
        };
    }

    // 2. Create requestId
    const requestId = uuidv4();
    logger.info(`New task created: ${requestId} (type: ${task.type})`);

    // 3. Pick the first available worker
    const workerId = availableWorkers[0];

    // 4. Write initial response headers
    //    (you may want to skip this if you plan to reassign the same `res` object multiple times,
    //     but for streaming SSE, we usually open them once)
    res.writeHead(200, {
        'Content-Type': (task.type === 'conversation') ? 'text/event-stream; charset=utf-8' : 'application/json',
        'Transfer-Encoding': 'chunked'
    });

    // 5. Store in global responseHandlers so we can stream data back
    responseHandlers[workerId] = {
        res,
        authToken,
        expectedUrl: (task.type === 'conversation')
            ? 'https://chatgpt.com/backend-api/conversation'
            : (task.request && task.request.url),
        requestId,
        createdAt: Date.now()
    };

    logger.info(`Assigned task ${requestId} to worker ${workerId} via WebSocket`);

    // 6. Build the "task with requestId" message
    const taskWithRequestId = {
        type: 'task',
        task: {
            ...task,
            response: null,
        },
        requestId
    };

    // 7. Send it down the WebSocket
    try {
        sockets[workerId].send(JSON.stringify(taskWithRequestId));
    } catch (error) {
        logger.error(`Failed to send task to worker ${workerId}: ${error.message}`);
        delete responseHandlers[workerId];
        return {
            error: 'Failed to send task to worker. Please try again.',
            status: 500
        };
    }

    // 8. Create a record in `pendingTasks` so we can track the ack
    pendingTasks[requestId] = {
        workerId,
        ack: false,
        res,
        authToken,
        retryCount,
        task,
        // We'll set a 3-second ack timeout
        ackTimeout: setTimeout(() => {
            if (!pendingTasks[requestId].ack) {
                logger.warn(`No ack from worker ${workerId} for request ${requestId} within 3s. Unregistering worker...`);
                // Remove worker
                unregisterWorker(workerId);
                // Clean up pending tasks
                delete pendingTasks[requestId];

                // Attempt re-assignment if we haven't maxed out attempts
                if (retryCount < 3) {
                    logger.info(`Retrying request ${requestId} with retryCount = ${retryCount + 1} ...`);
                    const nextResult = assignTaskToWorker(task, res, authToken, retryCount + 1);
                    if (nextResult.error && !res.headersSent) {
                        res.writeHead(nextResult.status || 500, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({ error: nextResult.error }));
                    }
                } else {
                    logger.error(`Maximum retry attempts reached for ${requestId}`);
                    if (!res.headersSent) {
                        res.writeHead(503, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({
                            error: 'Maximum worker retries reached. Please try again later.'
                        }));
                    }
                }
            }
        }, 3000) // 3-second ack deadline
    };

    return { success: true };
}

function unregisterWorker(workerId) {
    if (!workers[workerId]) {
        return { error: 'Worker not found' };
    }

    logger.info(`Worker ${workerId} unregistered`);

    // Clean up resources
    if (sockets[workerId]) {
        try {
            sockets[workerId].close();
        } catch (error) {
            logger.error(`Error closing socket for worker ${workerId}: ${error.message}`);
        }
        delete sockets[workerId];
    }

    // If worker had a pending task, mark it as failed
    if (responseHandlers[workerId]) {
        try {
            const res = responseHandlers[workerId].res;
            if (!res.writableEnded) {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Worker disconnected unexpectedly'}));
            }
        } catch (error) {
            logger.error(`Error handling response for unregistered worker ${workerId}: ${error.message}`);
        }
        delete responseHandlers[workerId];
    }

    delete workers[workerId];

    return { success: true };
}

module.exports = {
    assignTaskToWorker,
    unregisterWorker
};