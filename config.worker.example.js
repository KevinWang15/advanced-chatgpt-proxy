const config = {
    adminConsole: {
        "adminPassword": "admin"
    },
    // choose either chrome or adspower
    chrome: {
        // bin: "/usr/bin/google-chrome",
        bin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    },

    // choose either chrome or adspower
    adspower: {
        baseUrl: "http://local.adspower.net:xxxxx",
        apiKey: "xxxxx",
        groupId: "xxxxx"
    },

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
