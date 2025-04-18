// launchChrome.js

const {spawn} = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const findGitRoot = require('find-git-root');

const config = require(path.join(__dirname, "..", process.env.CONFIG));
const {mapAccountNameToPort} = require("../state/state");
const {rimraf} = require("rimraf");
const AdsPowerClient = require("./adspower");
const gitRoot = findGitRoot('.');

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

// 3) Create the extension folder for each account
function createAutomationExtension(extensionDir, cookies, account) {
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
          func: (account) => {
            localStorage.setItem('chatgptAccount', account);
          },
          args: [${JSON.stringify(JSON.stringify(account))}]
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

//
// 4) Main routine to spawn Chrome for each account, loading our extension
//
async function startChromeWithoutPuppeteer() {
    for (const account of config.accounts) {
        // Unique user-data-dir per account
        const profileHash = crypto
            .createHash('sha256')
            .update(account.name)
            .digest('hex');
        const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
        rimraf.sync(userDataDir);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, {recursive: true});
        }

        // Build cookies array from raw cookie string
        const cookiesArray = getCookies(account.cookie);

        // Create extension in a subfolder
        const extensionPath = path.join(userDataDir, "automation-extension");
        createAutomationExtension(extensionPath, cookiesArray, account);

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


// Helper to get or create AdsPower profile for an account
async function getOrCreateAdsPowerProfile(adsClient, account) {
    // Create a unique hash for this account to use as profile name
    const profileHash = crypto
        .createHash('sha256')
        .update(account.name)
        .digest('hex')
        .substring(0, 8);
    
    const profileName = `${account.name} (${profileHash})`;
    
    // First, try to list existing profiles
    try {
        console.log(`Checking for existing AdsPower profile for account: ${account.name}`);
        const listResponse = await adsClient.listProfiles(config.adspower.groupId);
        
        if (listResponse.code === 0 && listResponse.data && listResponse.data.list) {
            // Look for a profile with matching name
            const existingProfile = listResponse.data.list.find(profile => profile.name === profileName);
            
            if (existingProfile && existingProfile.user_id) {
                console.log(`Found existing AdsPower profile for account: ${account.name} (${existingProfile.user_id})`);
                return existingProfile.user_id;
            }
        }
    } catch (error) {
        console.warn(`Error listing AdsPower profiles: ${error.message}`);
        // Continue to create a new profile
    }

    // Create a new profile if none found
    console.log(`Creating new AdsPower profile for account: ${account.name} (${profileHash})`);

    // Configure proxy settings for this profile
    const proxyConfig = {
        proxy_soft: 'other',
        proxy_type: 'http',
        proxy_host: '127.0.0.1',
        proxy_port: mapAccountNameToPort[account.name],
        proxy_user: '',
        proxy_password: ''
    };

    // Create the profile with randomized fingerprint
    const createResponse = await adsClient.createProfile({
        name: profileName,
        groupId: config.adspower.groupId,
        proxyConfig: proxyConfig,
        fingerprintConfig: {}
    });

    if (createResponse.code !== 0) {
        throw new Error(`Failed to create AdsPower profile: ${createResponse.msg}`);
    }

    return createResponse.data.id;
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
            const profileHash = crypto
                .createHash('sha256')
                .update(account.name)
                .digest('hex');

            const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
            rimraf.sync(userDataDir);
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, {recursive: true});
            }

            // Build cookies array from raw cookie string
            const cookiesArray = getCookies(account.cookie);

            // Create extension in a subfolder
            const extensionPath = path.join(userDataDir, "automation-extension");
            createAutomationExtension(extensionPath, cookiesArray, account);

            // Start browser with these settings
            let launchArgs = [
                `--user-data-dir=${userDataDir}`,
                '--allow-insecure-localhost',
                '--ignore-urlfetcher-cert-requests',
                '--ignore-certificate-errors',
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

            if (os.platform() === 'darwin') {
                launchArgs.push('--use-mock-keychain');
            }

            const startResponse = await adsClient.openBrowser(profileId, {
                urls: ['https://chatgpt.com'],
                launchArgs: launchArgs
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

module.exports = {startChromeWithoutPuppeteer, startWithAdsPower};
