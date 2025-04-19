const config = {
    centralServer: {
        socketIoPort: 6088,
        port: process.env.PORT || 1234,
        host: process.env.HOST || '0.0.0.0',
        get url() {
            return "http://192.168.50.35:1234"
        },
        auth: {
            passcode: process.env.PASSCODE || 'securepasscode123',
        }
    },
};

module.exports = config;
