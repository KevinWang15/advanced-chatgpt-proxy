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

// Time-based usage counter for tracking recent activity (past 3 hours)
// Structure: { accountName: { timestamp1: count1, timestamp2: count2, ... } }
const timeBasedUsageCounters = {};

// Keep track of each account’s status
const accountStatusMap = {};

/**
 * Increment usage counters.
 * @param {string} realAccountName
 * @param {string} model
 */
function incrementUsage(realAccountName, model) {
    const key = `${realAccountName}||${model}`;
    usageCounters[key] = (usageCounters[key] || 0) + 1;

    // Also track time-based usage for load calculation
    const timestamp = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000); // Round to 5-minute buckets
    if (!timeBasedUsageCounters[realAccountName]) {
        timeBasedUsageCounters[realAccountName] = {};
    }
    timeBasedUsageCounters[realAccountName][timestamp] = (timeBasedUsageCounters[realAccountName][timestamp] || 0) + 1;
}


/**
 * Calculate account load based on usage in the past 3 hours
 * @param {string} accountName
 * @returns {number} Load value between 0-100
 */
function calculateAccountLoad(accountName) {
    if (!timeBasedUsageCounters[accountName]) {
        return 0;
    }

    const now = Date.now();
    const threeHoursAgo = now - (3 * 60 * 60 * 1000);

    // Sum up all usage in the past 3 hours
    let recentUsage = 0;
    for (const [timestamp, count] of Object.entries(timeBasedUsageCounters[accountName])) {
        if (parseInt(timestamp) >= threeHoursAgo) {
            recentUsage += count;
        }
    }

    // Clean up old entries (older than 3 hours)
    Object.keys(timeBasedUsageCounters[accountName]).forEach(timestamp => {
        if (parseInt(timestamp) < threeHoursAgo) {
            delete timeBasedUsageCounters[accountName][timestamp];
        }
    });

    // Use arctan function to map usage to a 0-100 scale
    // arctan(x/50) * (2/π) * 100 gives a nice curve that reaches ~50 at x=50 and approaches 100 asymptotically
    return Math.round(Math.atan(recentUsage / 50) * (2 / Math.PI) * 100);
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
