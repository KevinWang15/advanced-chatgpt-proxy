/**
 * Logger with timestamp and level
 */
const logger = {
    info: (message) => console.log(`[${new Date().toISOString()}] INFO: ${message}`),
    error: (message) => console.error(`[${new Date().toISOString()}] ERROR: ${message}`),
    warn: (message) => console.warn(`[${new Date().toISOString()}] WARN: ${message}`)
};

module.exports = {
    logger,
};