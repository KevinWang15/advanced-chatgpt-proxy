const config = {
    chromeBinPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // chromeBinPath: "/usr/bin/google-chrome",
    worker: {
        centralServer: "127.0.0.1:6088"
    },
    accounts: [
        {
            name: "email",
            labels: {
                plan: "plus"
            },
            cookie: "__cf_bm=...",
            accessToken: "eyJhbGc...",
            proxy: "https://user:pass@proxy:1901",
        },
    ]
};

module.exports = config;
