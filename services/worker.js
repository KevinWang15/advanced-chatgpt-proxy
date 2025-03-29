const {
    workers,
    responseHandlers,
    sockets
} = require("../state/state");
const {v4: uuidv4} = require("uuid");
const {logger} = require("../utils/utils");

// Function to assign a task to a worker
function assignTaskToWorker(task, res, authToken) {
    // Find available workers (since we're only using them once, we just need sockets)
    const availableWorkers = Object.keys(sockets)
        .filter(workerId => workers[workerId] && !responseHandlers[workerId]);

    if (availableWorkers.length === 0) {
        // If no worker is available, return error
        return {
            error: 'No workers available. Please copy your prompt for later reuse, then refresh the page. Don\'t use the retry button, as the original prompt was never sent to the server, so retrying won\'t work.',
            status: 503
        };
    }

    const requestId = uuidv4();
    logger.info(`New task created: ${requestId} (type: ${task.type})`);

    // Select the first available worker
    const workerId = availableWorkers[0];

    // Set up response stream
    res.writeHead(200, {
        'Content-Type': task.type === 'conversation' ? 'text/event-stream; charset=utf-8' : 'application/json',
        'Transfer-Encoding': 'chunked'
    });

    // Store response handler
    responseHandlers[workerId] = {
        res: res,
        authToken: authToken,
        expectedUrl: task.type === 'conversation'
            ? "https://chatgpt.com/backend-api/conversation"
            : task.request.url,
        requestId: requestId,
        createdAt: Date.now()
    };

    logger.info(`Assigned task ${requestId} to worker ${workerId} via WebSocket`);

    // Add request ID to the task
    const taskWithRequestId = {
        type: 'task',
        task: {
            ...task,
            response: null,
        },
        requestId
    };

    // Send the task to the worker
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

    return {success: true};
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