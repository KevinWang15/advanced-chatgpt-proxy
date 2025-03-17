const {PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Record usage for an account with specific model
 * @param {string} accountName - The account name
 * @param {string} model - The model used (e.g., "gpt-4", "gpt-3.5-turbo")
 * @returns {Promise<boolean>} - Success status
 */
async function recordUsage(accountName, model) {
    // Calculate load factor based on model
    let loadFactor = 1.0;

    // Store usage in database for load calculation
    const timestamp = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000); // Round to 5-minute buckets

    try {
        // Update or create usage record
        await prisma.accountUsage.upsert({
            where: {
                accountName_model_timestamp: {
                    accountName: accountName,
                    model: model,
                    timestamp: BigInt(timestamp)
                }
            },
            update: {
                count: {
                    increment: 1
                }
            },
            create: {
                accountName: accountName,
                model: model,
                timestamp: BigInt(timestamp),
                count: 1,
                loadFactor: loadFactor
            }
        });

        return true;
    } catch (error) {
        console.error(`Error recording usage: ${error.message}`);
        return false;
    }
}

/**
 * Calculate account load based on usage in the past 3 hours using database records
 * @param {string} accountName - The account name
 * @returns {Promise<number>} - Load value between 0-100
 */
async function calculateLoad(accountName) {
    try {
        const now = Date.now();
        const threeHoursAgo = now - (3 * 60 * 60 * 1000);

        // Get all usage records for this account in the past 3 hours
        const usageRecords = await prisma.accountUsage.findMany({
            where: {
                accountName: accountName,
                timestamp: {
                    gte: BigInt(threeHoursAgo)
                }
            }
        });

        if (usageRecords.length === 0) {
            return 0;
        }

        // Sum up all usage in the past 3 hours, taking load factor into account
        let recentUsage = 0;
        for (const record of usageRecords) {
            recentUsage += record.count * record.loadFactor;
        }

        // Use arctan function to map usage to a 0-100 scale
        // arctan(x/50) * (2/π) * 100 gives a nice curve that reaches ~50 at x=50 and approaches 100 asymptotically
        return Math.round(Math.atan(recentUsage / 50) * (2 / Math.PI) * 100);
    } catch (error) {
        console.error(`Error calculating account load: ${error.message}`);
        return 0;
    }
}

/**
 * Clean up old account usage records (older than 2 days)
 * @returns {Promise<number>} - Number of records deleted
 */
async function cleanupOldRecords() {
    try {
        const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
        const result = await prisma.accountUsage.deleteMany({
            where: {
                timestamp: {
                    lt: BigInt(twoDaysAgo)
                }
            }
        });

        console.log(`Cleaned up ${result.count} old account usage records`);
        return result.count;
    } catch (error) {
        console.error(`Error cleaning up old account usage records: ${error.message}`);
        return 0;
    }
}

/**
 * Setup a daily cleanup job for old records
 */
function setupCleanupTask() {
    // Run cleanup once when service starts
    cleanupOldRecords().catch(console.error);

    // Then schedule cleanup to run once per day
    const CLEANUP_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
    setInterval(() => {
        cleanupOldRecords().catch(console.error);
    }, CLEANUP_INTERVAL);
}

// Initialize cleanup task
setupCleanupTask();

/**
 * Get account usage data for the past 24 hours, aggregated by model
 * @returns {Promise<Object>} - Aggregated usage data by model
 */
async function getAggregatedUsageByModel() {
    try {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        // Get all usage records for the past 24 hours
        const usageRecords = await prisma.accountUsage.findMany({
            where: {
                timestamp: {
                    gte: BigInt(oneDayAgo)
                }
            }
        });

        // Aggregate by model
        const aggregatedByModel = {};

        for (const record of usageRecords) {
            const { model, count, accountName } = record;

            if (!aggregatedByModel[model]) {
                aggregatedByModel[model] = {
                    totalCount: 0,
                    accounts: {}
                };
            }

            aggregatedByModel[model].totalCount += count;

            if (!aggregatedByModel[model].accounts[accountName]) {
                aggregatedByModel[model].accounts[accountName] = 0;
            }

            aggregatedByModel[model].accounts[accountName] += count;
        }

        return aggregatedByModel;
    } catch (error) {
        console.error(`Error getting aggregated usage by model: ${error.message}`);
        return {};
    }
}

/**
 * Get usage data per account for the past 24 hours
 * @returns {Promise<Object>} - Usage data organized by account
 */
async function getUsageByAccount() {
    try {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        // Get all usage records for the past 24 hours
        const usageRecords = await prisma.accountUsage.findMany({
            where: {
                timestamp: {
                    gte: BigInt(oneDayAgo)
                }
            }
        });

        // Organize by account
        const usageByAccount = {};

        for (const record of usageRecords) {
            const { accountName, model, count, loadFactor, timestamp } = record;

            if (!usageByAccount[accountName]) {
                usageByAccount[accountName] = {
                    totalCount: 0,
                    totalLoad: 0,
                    models: {},
                    timeDistribution: {}
                };
            }

            // Increment total count for this account
            usageByAccount[accountName].totalCount += count;

            // Increment total load (count * loadFactor)
            usageByAccount[accountName].totalLoad += count * loadFactor;

            // Add data per model
            if (!usageByAccount[accountName].models[model]) {
                usageByAccount[accountName].models[model] = 0;
            }
            usageByAccount[accountName].models[model] += count;

            const date = new Date(Number(timestamp));
            const dateHourKey = `${date.toISOString().split('T')[0]}_${date.getHours()}`;
            if (!usageByAccount[accountName].timeDistribution[dateHourKey]) {
                usageByAccount[accountName].timeDistribution[dateHourKey] = 0;
            }
            usageByAccount[accountName].timeDistribution[dateHourKey] += count;
        }

        return usageByAccount;
    } catch (error) {
        console.error(`Error getting usage by account: ${error.message}`);
        return {};
    }
}

module.exports = {
    recordUsage,
    calculateLoad,
    cleanupOldRecords,
    getAggregatedUsageByModel,
    getUsageByAccount
};