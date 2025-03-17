const config = {
    centralServer: {
        socketIoPort: 6088,
        port: process.env.PORT || 1234,
        host: process.env.HOST || '127.0.0.1',
        get url() {
            return "http://127.0.0.1:1234"
        },
        auth: {
            passcode: process.env.PASSCODE || 'securepasscode123',
            integrationApiKey: process.env.INTEGRATION_API_KEY || 'integration_key_example',
            monitoringToken: process.env.MONITORING_TOKEN || 'monitoring_access_token_123',
        }
    },
};

module.exports = config;
