// launchChrome.js

const {spawn} = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const findGitRoot = require('find-git-root');

const config = require('../config');
const {mapAccountNameToPort} = require("../state/state");
const AdsPowerClient = require('./adspower');
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
// 2) Minimal "Master Cookie" definition and helpers
//

// Example "master cookies" for chatgpt.com
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
//    with a "background.js" that:
//    - Sets proxy credentials
//    - On extension startup: sets cookies, ensures at least 10 ChatGPT tabs
//
function createAutomationExtension(extensionDir, cookies, accountName) {
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
            "webRequestAuthProvider",
            "scripting"
        ],
        host_permissions: [
            "<all_urls>"
        ],
        background: {
            service_worker: "background.js",
            type: "module"
        }
    };
    
    // Save account name to a global variable in the extension

    const backgroundJs = `
    // Inject code to set account name in localStorage for the page
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url && tab.url.includes('chatgpt.com')) {
        chrome.scripting.executeScript({
          target: { tabId },
          func: (accountName) => {
            localStorage.setItem('chatgptProxyAccountName', accountName);
            console.log('Account name saved to localStorage:', accountName);
          },
          args: ['${accountName}']
        });
      }
    });
    
    // ================
    // Proxy Auth
    // ================
    chrome.webRequest.onAuthRequired.addListener(
      (details) => {
        if (details.isProxy) {
          return {
            authCredentials: {
              // username: "",
              // password: ""
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

// Helper to get or create AdsPower profile for an account
async function getOrCreateAdsPowerProfile(adsClient, account) {
    // Check if account exists in the profile map
    if (config.adspower.profileMap && config.adspower.profileMap[account.name]) {
        console.log(`Using existing AdsPower profile for account: ${account.name}`);
        return config.adspower.profileMap[account.name];
    }

    // Create a unique hash for this account to use as profile name
    const profileHash = crypto
        .createHash('sha256')
        .update(account.name)
        .digest('hex')
        .substring(0, 8);
    
    // Create a new profile
    console.log(`Creating new AdsPower profile for account: ${account.name} (${profileHash})`);
    
    // Configure proxy settings for this profile
    const proxyConfig = {
        proxy_soft: 'custom',
        proxy_type: 'http',
        proxy_host: '127.0.0.1',
        proxy_port: mapAccountNameToPort[account.name],
        proxy_user: '',
        proxy_password: ''
    };

    // Create the profile with randomized fingerprint
    const createResponse = await adsClient.createProfile({
        name: `${account.name} (${profileHash})`,
        groupId: config.adspower.groupId,
        proxyConfig: proxyConfig,
        fingerprintConfig: {
            browser_kernel: 'chrome',
            webrtc: 'proxy',   // Use proxy for WebRTC
            canvas: 'noise',   // Add random noise to canvas
            client_rects: 'noise', // Add noise to ClientRects
            webgl: 'noise',    // Add noise to WebGL fingerprint
            webgl_image: 'noise', // Add noise to WebGL images
            audio: 'noise',    // Add noise to audio fingerprint
            hardware_concurrency: Math.floor(Math.random() * 8) + 2, // Random number of cores
            device_memory: [2, 4, 8][Math.floor(Math.random() * 3)], // Random memory
            language: 'en-US',
            platform: 'Win32',
            do_not_track: Math.random() > 0.5 ? 0 : 1, // Random DNT value
            flash: 0   // No Flash
        }
    });

    if (createResponse.code !== 0) {
        throw new Error(`Failed to create AdsPower profile: ${createResponse.msg}`);
    }

    return createResponse.data.id;
}

//
// 4) Main routine to spawn browsers for each account
//
async function startChromeWithoutPuppeteer() {
    // Use AdsPower if enabled
    if (config.adspower && config.adspower.enabled) {
        await startWithAdsPower();
    } else {
        await startWithDirectChrome();
    }
}

// Launch browsers using AdsPower
async function startWithAdsPower() {
    console.log("Starting browsers with AdsPower");
    
    const adsClient = new AdsPowerClient({
        baseUrl: config.adspower.baseUrl,
        apiKey: config.adspower.apiKey
    });
    
    for (const account of config.accounts) {
        try {
            // Get or create profile for this account
            const profileId = await getOrCreateAdsPowerProfile(adsClient, account);
            console.log(`Using AdsPower profile ${profileId} for account ${account.name}`);
            
            // Format cookies for this account
            const cookies = adsClient.formatCookies(account.cookie, 'chatgpt.com');
            
            // Update cookies in the AdsPower profile
            await adsClient.updateCookies(profileId, cookies);
            
            // Start browser with these settings
            const startResponse = await adsClient.openBrowser(profileId, {
                urls: ['https://chatgpt.com'],
                launchArgs: [
                    '--allow-insecure-localhost',
                    '--ignore-urlfetcher-cert-requests',
                    '--ignore-certificate-errors'
                ]
            });
            
            if (startResponse.code !== 0) {
                throw new Error(`Failed to start AdsPower browser: ${startResponse.msg}`);
            }
            
            console.log(`Successfully launched AdsPower browser for account: ${account.name} (profile: ${profileId})`);
        } catch (error) {
            console.error(`Error starting AdsPower browser for account ${account.name}:`, error);
        }
    }
}

// Original Chrome launching function
async function startWithDirectChrome() {
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
        createAutomationExtension(extensionPath, cookiesArray, account.name);

        // Now spawn Chrome as a normal process
        // The below flags are somewhat similar to those you used with Puppeteer
        const chromeArgs = [
            `--user-data-dir=${userDataDir}`,
            `--proxy-server=http://127.0.0.1:${mapAccountNameToPort[account.name]}`,
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
            '--no-first-run',
            '--disable-infobars',
            '--disable-popup-blocking',
            '--disable-sync',
            '--disable-translate',
            '--password-store=basic',
            '--disable-features=CalculateNativeWinOcclusion',
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