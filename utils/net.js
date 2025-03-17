const net = require('net');

/**
 * Tries to find one free port, starting from `startPort`, scanning upward.
 * Resolves with the first available port number if successful, otherwise rejects.
 */
function findFreePort(startPort = 1081, maxSearch = 65535) {
    return new Promise((resolve, reject) => {
        if (startPort > maxSearch) {
            return reject(new Error('No available port found before reaching the max search limit.'));
        }

        const server = net.createServer();

        server.once('error', (err) => {
            server.close();
            // If port is in use or cannot be bound, try the next port
            if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                resolve(findFreePort(startPort + 1, maxSearch));
            } else {
                reject(err);
            }
        });

        server.listen(startPort, () => {
            const {port} = server.address();
            server.close(() => resolve(port));
        });
    });
}

/**
 * Finds `count` distinct free ports, starting from `startPort` (defaults to 1081).
 * Throws if it cannot find enough free ports before reaching `maxSearch`.
 */
async function findNFreePorts(count, startPort = 1081, maxSearch = 65535) {
    const ports = [];

    let currentPort = startPort;
    while (ports.length < count) {
        const freePort = await findFreePort(currentPort, maxSearch);
        ports.push(freePort);

        // Move to the next port after the newly discovered free one
        currentPort = freePort + 1;

        // If we exceed the maximum allowed port range and still don't have enough ports, throw
        if (currentPort > maxSearch && ports.length < count) {
            throw new Error('Not enough free ports available in the specified range.');
        }
    }

    return ports;
}

module.exports = {findNFreePorts}