// Data structures to manage workers and requests
const workers = {};
const responseHandlers = {}; // Combined structure for response and expected URL
const sockets = {}; // Map workerId to WebSocket

module.exports = {
    workers,
    responseHandlers,
    sockets
}