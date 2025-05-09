const {PrismaClient} = require('@prisma/client');
const {faker} = require('@faker-js/faker');
const crypto = require('crypto');
const {v4: uuidv4} = require('uuid');
const {getAllAccounts, calculateAccountLoad} = require("../state/state");
const prisma = new PrismaClient();
const path = require("path");
const config = require(path.join(__dirname, "..", process.env.CONFIG));

class AnonymizationService {
    constructor() {
        this.cache = new Map();
        this.idCache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 minutes in milliseconds
    }

    /**
     * Generates a deterministic seed from an email
     * @param {string} email - The email to generate a seed from
     * @returns {number} A deterministic seed
     */
    _getSeedFromEmail(email) {
        const hash = crypto.createHash('md5').update(email).digest('hex');
        return parseInt(hash.substring(0, 8), 16);
    }

    /**
     * Generate avatar URL using our local avatar service
     * @param {string} seed - The seed for avatar generation
     * @returns {string} Avatar URL
     * @private
     */
    _generateAvatarUrl(seed) {
        const colors = '264653,2a9d8f,e9c46a,f4a261,e76f51';
        const size = 120;

        return `/avatar/${size}/${encodeURIComponent(seed)}?colors=${colors}`;
    }

    /**
     * Generates fake data for anonymization
     * @param {string} realAccountName - The real email to base the generation on
     * @returns {Object} Object containing fake data
     */
    _generateFakeData(realAccountName) {
        // Generate a deterministic seed from the email
        const seed = this._getSeedFromEmail(realAccountName);
        faker.seed(seed);

        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const fullName = `${firstName} ${lastName}`;
        const fakeEmail = faker.internet.email({firstName, lastName}).toLowerCase();

        return {
            fakeEmail: fakeEmail,
            fakeName: fullName,
            fakeAvatar: this._generateAvatarUrl(fakeEmail),
        };
    }

    /**
     * Get or create an anonymized account for a real account name/email
     * @param {string} realAccountName - The real email to anonymize
     * @returns {Promise<Object>} Object containing only public-facing account data (id, fake details)
     */
    async getOrCreateAnonymizedAccount(realAccountName) {
        if (!realAccountName) {
            throw new Error('Real email is required');
        }

        // Check cache first
        if (this.cache.has(realAccountName)) {
            const cachedData = this.cache.get(realAccountName);
            if (Date.now() < cachedData.expiresAt) {
                return this._sanitizeAccountData(cachedData.data);
            }
            // Cache expired, remove it
            this.cache.delete(realAccountName);
        }

        // Get from database or create if doesn't exist
        let account = await prisma.chatGPTAccount.findUnique({
            where: {realAccountName},
        });

        if (!account) {
            // Create new anonymized account with fake data and UUID
            const fakeData = this._generateFakeData(realAccountName);

            account = await prisma.chatGPTAccount.create({
                data: {
                    id: uuidv4(),
                    realAccountName,
                    ...fakeData,
                },
            });
        }

        // Store in cache (both email-based and id-based)
        const cacheData = {
            data: account,
            expiresAt: Date.now() + this.cacheTTL,
        };

        this.cache.set(realAccountName, cacheData);
        this.idCache.set(account.id, cacheData);

        // Return only public data
        return this._sanitizeAccountData(account);
    }

    /**
     * Sanitize account data to only return public-facing information
     * @param {Object} account - The complete account data object
     * @returns {Object} Object with only public-facing information
     * @private
     */
    _sanitizeAccountData(account) {
        return {
            id: account.id,
            fakeName: account.fakeName,
            fakeEmail: account.fakeEmail,
            fakeAvatar: account.fakeAvatar
        };
    }

    /**
     * Get the real email for an account ID (server-side only)
     * @param {string} id - The account ID
     * @returns {Promise<string|null>} The real email or null if not found
     */
    async getRealAccountNameById(id) {
        // Check cache first
        if (this.idCache.has(id)) {
            const cachedData = this.idCache.get(id);
            if (Date.now() < cachedData.expiresAt) {
                return cachedData.data.realAccountName;
            }
            // Cache expired, remove it
            this.idCache.delete(id);
        }

        const account = await prisma.chatGPTAccount.findUnique({
            where: {id},
            select: {realAccountName: true}
        });

        return account ? account.realAccountName : null;
    }

    async getSelectedAccountById(id) {
        const allAccounts = await this.getAllAccountsWithAnonymizedData();
        return allAccounts.find(account => account.id === id);
    }

    async getAllAccountsWithAnonymizedData() {
        const accounts = await Promise.all(
            getAllAccounts().map(async x => {
                // Get the most recent degradation check result from the database
                const latestResult = await prisma.degradationCheckResult.findFirst({
                    where: {
                        accountName: x.name
                    },
                    orderBy: {
                        checkTime: 'desc'
                    }
                });

                const degradation = latestResult?.degradation ?? null;

                const load = calculateAccountLoad(x.name);
                return {
                    name: x.name,
                    labels: x.labels || {},
                    degradation: degradation, // 0 is no degradation, 1 is slightly degraded, 2 is severely degraded
                    load: load // 0 to 100, based on usage in the past 3 hours
                };
            })
        );

        return await Promise.all(accounts.map(async (account) => {
            const anonymizedAccount = await this.getOrCreateAnonymizedAccount(account.name);
            return {
                ...account,
                id: anonymizedAccount.id,
                name: anonymizedAccount.fakeName,
                email: anonymizedAccount.fakeEmail,
                avatar: anonymizedAccount.fakeAvatar.startsWith('/') ? config.centralServer.url + anonymizedAccount.fakeAvatar : anonymizedAccount.fakeAvatar,
            };
        }))
    }
}

// Export singleton instance
const anonymizationService = new AnonymizationService();
module.exports = anonymizationService;