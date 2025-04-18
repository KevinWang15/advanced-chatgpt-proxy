const path = require("path");
const config = require(path.join(__dirname, "..", process.env.CONFIG));

// Store worker data in a Map keyed by workerId
// Example structure of each entry:
// workers[workerId] = {
//   socket: <Socket>,
//   available: <Boolean> - used to see if worker is free to handle new work
//   responseWriter
//   accountInfo: { name, labels, ... } - full account info
// }
const workers = {};

// Get all accounts based on connected workers
const getAllAccounts = () => {
    const accounts = {};

    for (const workerId in workers) {
        const worker = workers[workerId];
        if (worker.accountInfo) {
            accounts[worker.accountInfo.name] = worker.accountInfo;
        }
    }

    return Object.values(accounts);
};

const mapAccountNameToPort = {};
const mapPortToAccountName = {};

const getSocketIOServerPort = async () => {
    if (!config.centralServer?.socketIoPort) {
        throw new Error("config.centralServer.socketIoPort must be set");
    }
    return config.centralServer.socketIoPort;
};

module.exports = {
    mapAccountNameToPort,
    mapPortToAccountName,
    getSocketIOServerPort,
    workers,
    getAllAccounts,
};
