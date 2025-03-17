// launchChrome.js

const {spawn} = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const findGitRoot = require('find-git-root');

const config = require('../config');
const gitRoot = findGitRoot('.');

//
// 1) Function to parse proxy credentials
//
function parseProxy(proxyStr) {
    try {
        const parsedUrl = new URL(proxyStr);
        return {
            protocol: parsedUrl.protocol,  // e.g. "https:"
            host: parsedUrl.host,          // e.g. "site.com:8080"
            username: parsedUrl.username,  // e.g. "user"
            password: parsedUrl.password   // e.g. "pass"
        };
    } catch (err) {
        throw new Error(`Invalid proxy URL: ${proxyStr} — ${err.message}`);
    }
}

//
// 2) Minimal “Master Cookie” definition and helpers
//

// Example “master cookies” for chatgpt.com
const MASTER_COOKIES = [
    {
        name: '__Secure-next-auth.callback-url',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.0',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.1',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.2',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: 'oai-did',
        domain: 'chatgpt.com',
        path: '/',
    },
    {
        name: 'oai-gn',
        domain: 'chatgpt.com',
        path: '/',
    },
    {
        name: 'oai-hlib',
        domain: 'chatgpt.com',
        path: '/',
    },
];

function parseCookies(cookieString) {
    const cookieMap = {};
    const parts = cookieString.split(/;\s*/);
    for (const part of parts) {
        const index = part.indexOf('=');
        if (index > -1) {
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (name) {
                cookieMap[name] = value;
            }
        }
    }
    return cookieMap;
}

function getCookies(cookieString) {
    const parsedInput = parseCookies(cookieString);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const oneMonthSeconds = 30 * 24 * 60 * 60; // ~30 days
    const expirationTime = nowSeconds + oneMonthSeconds;

    return MASTER_COOKIES
        .filter(template => parsedInput[template.name]) // only those that exist in user input
        .map(template => {
            return {
                name: template.name,
                domain: template.domain,
                path: template.path,
                secure: !!template.secure,
                httpOnly: !!template.httpOnly,
                sameSite: template.sameSite || 'lax',

                // For MV3 `chrome.cookies.set()`, you'll want fields like this:
                url: `https://${template.domain}${template.path}`,
                value: parsedInput[template.name],

                // If you want them to persist, you can set an expirationDate
                expirationDate: expirationTime
            };
        });
}

//
// 3) Create the extension folder for each account
//    with a “background.js” that:
//    - Sets proxy credentials
//    - On extension startup: sets cookies, ensures at least 10 ChatGPT tabs
//
function createAutomationExtension(extensionDir, username, password, cookies) {
    fs.mkdirSync(extensionDir, {recursive: true});

    // A minimal MV3 manifest.json
    const manifest = {
        manifest_version: 3,
        name: "Automation Extension",
        version: "1.0",
        permissions: [
            "cookies",
            "tabs",
            "webRequest",
            "webRequestAuthProvider"
        ],
        host_permissions: [
            "<all_urls>"
        ],
        background: {
            service_worker: "background.js",
            type: "module"
        }
    };

    const backgroundJs = `
    // ================
    // Proxy Auth
    // ================
    chrome.webRequest.onAuthRequired.addListener(
      (details) => {
        if (details.isProxy) {
          return {
            authCredentials: {
              username: "${username}",
              password: "${password}"
            }
          };
        }
      },
      { urls: ["<all_urls>"] },
      ["blocking"]
    );

    // ================
    // Cookie + Tab Management
    // ================
    (async function() {
      try {
        // 1) Set cookies for chatgpt.com
        const cookies = ${JSON.stringify(cookies, null, 2)};
        for (const c of cookies) {
          await chrome.cookies.set(c);
        }

        // 2) Ensure at least 10 tabs are open to https://chatgpt.com
        chrome.tabs.query({}, function(allTabs) {
          const chatgptTabs = allTabs.filter(t => t.url && t.url.includes("chatgpt.com"));
          const needed = 10 - chatgptTabs.length;
          // for (let i = 0; i < needed; i++) {
          //   chrome.tabs.create({ url: "https://chatgpt.com" });
          // }
        });
      } catch (err) {
        console.error("[Automation Extension] Error in background script:", err);
      }
    })();
    `;

    // Write manifest.json
    fs.writeFileSync(
        path.join(extensionDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
    );

    // Write background.js
    fs.writeFileSync(
        path.join(extensionDir, 'background.js'),
        backgroundJs,
        'utf8'
    );
}

//
// 4) Main routine to spawn Chrome for each account, loading our extension
//
async function startChromeWithoutPuppeteer() {
    if (!config.proxy) {
        throw new Error("Proxy not set in config");
    }
    const {protocol, host, username, password} = parseProxy(config.proxy);

    for (const account of config.accounts) {
        // Unique user-data-dir per account
        const profileHash = crypto
            .createHash('sha256')
            .update(account.name)
            .digest('hex');
        const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, {recursive: true});
        }

        // Build cookies array from raw cookie string
        const cookiesArray = getCookies(account.cookie);

        // Create extension in a subfolder
        const extensionPath = path.join(userDataDir, "automation-extension");
        createAutomationExtension(extensionPath, username, password, cookiesArray);

        // Now spawn Chrome as a normal process
        // The below flags are somewhat similar to those you used with Puppeteer
        const chromeArgs = [
            `--user-data-dir=${userDataDir}`,
            `--proxy-server=http://127.0.0.1:1235`,
            `--disable-extensions-except=${extensionPath},${path.resolve(gitRoot, "..", "chrome-extension")}`,
            `--load-extension=${extensionPath},${path.resolve(gitRoot, "..", "chrome-extension")}`,
            '--allow-insecure-localhost',
            '--ignore-urlfetcher-cert-requests',
            '--force-dark-mode',
            '--no-sandbox',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            '--disable-breakpad',
            '--metrics-recording-only',
            '--safebrowsing-disable-auto-update',
            '--disable-crash-reporter',
            '--disable-default-apps',
            '--no-default-browser-check',
            '--disable-infobars',
            '--disable-popup-blocking',
            '--disable-sync',
            '--disable-translate',
            '--password-store=basic',
            '--disable-blink-features=AutomationControlled',
            '--disable-renderer-backgrounding',
            '--force-color-profile=srgb',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-ipc-flooding-protection',
        ];

        // If macOS, optionally use the mock keychain
        if (os.platform() === 'darwin') {
            chromeArgs.push('--use-mock-keychain');
        }

        console.log(`Launching Chrome for account: ${account.name} (${profileHash})`);
        const child = spawn(config.chromeBinPath, chromeArgs, {
            stdio: 'inherit'
        });

        child.on('error', (err) => {
            console.error(`Failed to launch Chrome for ${account.name}:`, err);
        });

        child.on('exit', (code) => {
            console.log(`Chrome for ${account.name} exited with code ${code}`);
        });
    }
}

module.exports = {startChromeWithoutPuppeteer};
