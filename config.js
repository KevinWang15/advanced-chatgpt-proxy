const config = {
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
    proxy: {
        accessToken: process.env.ACCESS_TOKEN,
        cookie: process.env.COOKIE,
    },
    auth: {
        passcode: process.env.PASSCODE || 'securepasscode123',
    }
};

module.exports = config;
