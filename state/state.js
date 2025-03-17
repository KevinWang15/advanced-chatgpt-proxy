const path = require("path");
const config = require(path.join(__dirname, "..", process.env.CONFIG));
const accountLoadService = require("../services/accountLoad");

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

// TODO: code quality is abysmal, refactor this
const mapUserTokenToPendingNewConversation = {};

// Get all accounts based on connected workers
const getAllAccounts = () => {
    return Object.values(accounts);
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


// Global usage counter, mapping "accountName:model" -> numberOfCalls
const usageCounters = {};

// Keep track of each account's status
const accountStatusMap = {};

/**
 * Increment usage counters.
 * @param {string} realAccountName
 * @param {string} model
 */
async function incrementUsage(realAccountName, model) {
    // Update in-memory counter
    const key = `${realAccountName}||${model}`;
    usageCounters[key] = (usageCounters[key] || 0) + 1;

    // Record usage in database via the accountLoad service
    await accountLoadService.recordUsage(realAccountName, model);
}


/**
 * Calculate account load based on usage in the past 3 hours
 * @param {string} accountName
 * @returns {Promise<number>} Load value between 0-100
 */
async function calculateAccountLoad(accountName) {
    // Use the accountLoad service to calculate load from database
    return await accountLoadService.calculateLoad(accountName);
}

module.exports = {
    workers,
    accounts,
    getAllAccounts,
    purgeWorker,
    mapUserTokenToPendingNewConversation,
    calculateAccountLoad,
    usageCounters,
    incrementUsage,
    accountStatusMap
};