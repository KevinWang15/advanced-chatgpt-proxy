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
    proxy: process.env.PROXY,
    auth: {
        passcode: process.env.PASSCODE || 'securepasscode123',
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
