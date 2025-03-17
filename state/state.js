// Data structures to manage workers and requests
const workers = {}; // Just stores worker metadata now
const responseHandlers = {}; // Maps workerId to response handler info
const sockets = {}; // Maps workerId to WebSocket connection

module.exports = {
    workers,
    responseHandlers,
    sockets
};