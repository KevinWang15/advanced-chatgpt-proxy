const path = require("path");
const config = require(path.join(__dirname, "..", process.env.CONFIG));

// Store worker data in a Map keyed by workerId
// Example structure of each entry:
// workers[workerId] = {
//   socket: <Socket>,
//   available: <Boolean> - used to see if worker is free to handle new work
//   responseWriter
//   accountName
// }
const workers = {};

const accounts = {};

// Get all accounts based on connected workers
const getAllAccounts = () => {
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

function purgeWorker(workerId) {
    delete workers[workerId];

    const accountSeen = {};
    for (let id in workers) {
        if (workers[id] && workers[id].accountName) {
            accountSeen[workers[id].accountName] = true;
        }
    }

    for (let acc in accounts) {
        if (!accountSeen[acc]) {
            delete accounts[acc];
        }
    }
}

module.exports = {
    mapAccountNameToPort,
    mapPortToAccountName,
    getSocketIOServerPort,
    workers,
    accounts,
    getAllAccounts,
    purgeWorker,
};
