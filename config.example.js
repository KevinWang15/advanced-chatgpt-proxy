const config = {
    chromeBinPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    server: {
        port: process.env.PORT || 1234,
        host: process.env.HOST || '127.0.0.1',
        get url() {
            if (process.env.PUBLIC_HOST) {
                return process.env.PUBLIC_HOST;
            }
            return `http://${this.host}:${this.port}`;
        }
    },
    auth: {
        passcode: process.env.PASSCODE || 'securepasscode123',
    },
    // AdsPower configuration
    adspower: {
        enabled: process.env.USE_ADSPOWER === 'true', // Set to true to use AdsPower instead of direct Chrome
        apiKey: process.env.ADSPOWER_API_KEY || '', // Your AdsPower API key
        baseUrl: process.env.ADSPOWER_API_URL || 'http://localhost:50325', // AdsPower local API endpoint
        groupId: process.env.ADSPOWER_GROUP_ID || '', // Optional group ID for organizing profiles
        // Maps account names to AdsPower profile IDs (if you've already created profiles)
        profileMap: {
            // 'a@a.com': 'adspowerId1',
            // 'b@b.com': 'adspowerId2'
        }
    },
    accounts: [
        {
            name: "a@a.com",
            labels: {
                plan: "plus"
            },
            cookie: "__cf_bm=...",
            accessToken: "ey..."
        },
        {
            name: "b@a.com",
            labels: {
                plan: "pro"
            },
            cookie: "__cf_bm=...",
            accessToken: "ey..."
        },
    ]
};

module.exports = config;
