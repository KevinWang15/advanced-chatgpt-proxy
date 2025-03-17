const {
    workers,
    responseHandlers,
    sockets
} = require("../state/state");

// Function to assign a task to a worker
const {v4: uuidv4} = require("uuid");

function assignTaskToWorker(task, res, authToken) {
    // Find available workers sorted by last activity (prioritize least recently used)
    const availableWorkers = Object.keys(workers)
        .filter(workerId => !workers[workerId].busy && sockets[workerId])
        .sort((a, b) => workers[a].lastSeen - workers[b].lastSeen);

    if (availableWorkers.length === 0) {
        // If no worker is available, return error
        return {
            error: 'No workers available. Please copy your prompt for later reuse, then refresh the page. Don\'t use the retry button, as the original prompt was never sent to the server, so retrying won\'t work.',
            status: 503
        };
    }

    const requestId = uuidv4();
    console.log(`New task created: ${requestId}`);

    // Select the least recently used worker
    const workerId = availableWorkers[0];

    // TODO: this part should be transparent too
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
            : task.request.url
    };

    // Mark worker as busy
    workers[workerId].busy = true;

    console.log(`Assigned task ${requestId} to worker ${workerId} via WebSocket`);

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
    sockets[workerId].send(JSON.stringify(taskWithRequestId));

    return {success: true};
}

module.exports = {assignTaskToWorker};