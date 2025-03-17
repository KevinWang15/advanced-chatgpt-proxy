// launchChrome.js

const {spawn} = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const findGitRoot = require('find-git-root');
const http = require('http');
const puppeteer = require('puppeteer-core');

const config = require(path.join(__dirname, "..", process.env.CONFIG));
const {mapAccountNameToPort} = require("../state/state");
const AdsPowerClient = require("./adspower");
const {findNFreePorts} = require("../utils/net");
const gitRoot = findGitRoot('.');


//
// Main routine to spawn Chrome for each account, loading our extension
//
async function startWithChrome() {
    const freePorts = await findNFreePorts(config.accounts.length, 10000, 20000);

    for (let i = 0; i < config.accounts.length; i++) {
        const account = config.accounts[i];
        const port = freePorts[i];

        // Create a web server for each account
        const server = http.createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(genExtensionConfigurationHtml(account));
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        // Start the web server
        server.listen(port, () => {
            console.log(`Web server for account ${account.name || i} started on port ${port}`);
        });

        // Unique user-data-dir per account
        const profileHash = crypto
            .createHash('sha256')
            .update(account.name)
            .digest('hex');
        const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, {recursive: true});
        }


        // Now spawn Chrome as a normal process
        // The below flags are somewhat similar to those you used with Puppeteer
        const chromeArgs = [
            `--user-data-dir=${userDataDir}`,
            `--proxy-server=http://127.0.0.1:${mapAccountNameToPort[account.name]}`,
            `--disable-extensions-except=${path.resolve(gitRoot, "..", "chrome-extension")}`,
            `--load-extension=${path.resolve(gitRoot, "..", "chrome-extension")}`,
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
        const child = spawn(config.chromeBinPath, [...chromeArgs, `http://127.0.0.1:${port}`], {
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

function genExtensionConfigurationHtml(account) {
    return `
<!DOCTYPE html>
<html>
    <head>
        <title>Setting Up Extension</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                text-align: center;
                margin-top: 50px;
            }

            .container {
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                border: 1px solid #ccc;
                border-radius: 5px;
            }

            h2 {
                color: #333;
            }

            .loader {
                border: 5px solid #f3f3f3;
                border-top: 5px solid #3498db;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 2s linear infinite;
                margin: 20px auto;
            }

            @keyframes spin {
                0% {
                    transform: rotate(0deg);
                }

                100% {
                    transform: rotate(360deg);
                }
            }
            
            .done-message {
                color: green;
                font-weight: bold;
                font-size: 18px;
                margin-top: 20px;
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Setting Up Extension</h2>
            <p>Please wait while we configure your account...</p>
            <p>If it doesn't complete, please make sure you installed the browser extension</p>
            <div class="loader"></div>
            <div id="doneMessage" class="done-message">Done!</div>
        </div>
        <script>
            // Post account data to the extension running in the background
            window.addEventListener('load', function() {
                const accountData = ${JSON.stringify(account)};

                // Listen for the acknowledgment from content.js
                window.addEventListener('message', function(event) {
                    // Only accept messages from the same frame
                    if (event.source !== window) return;
                    
                    if (event.data.type === 'SETUP_COMPLETE') {
                        // Show "Done" message
                        document.getElementById('doneMessage').style.display = 'block';
                        // Hide the loader
                        document.querySelector('.loader').style.display = 'none';
                    }
                }, false);

                // Send message to extension background script via content.js
                setTimeout(() => {
                    window.postMessage({
                        type: 'SETUP_EXTENSION',
                        accountData: accountData
                    }, '*');
                }, 1000);
            });
        </script>
    </body>
</html>`;
}

// Launch browsers using AdsPower
async function startWithAdsPower() {
    console.log("Starting browsers with AdsPower");

    const freePorts = await findNFreePorts(config.accounts.length, 10000, 20000);
    for (let i = 0; i < config.accounts.length; i++) {
        const account = config.accounts[i];
        const port = freePorts[i];

        // Create a web server for each account
        const server = http.createServer((req, res) => {
            if (req.url === '/') {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(genExtensionConfigurationHtml(account));
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        // Start the web server
        server.listen(port, () => {
            console.log(`Web server for account ${account.name || i} started on port ${port}`);
        });
    }

    const adsClient = new AdsPowerClient({
        baseUrl: config.adspower.baseUrl,
        apiKey: config.adspower.apiKey
    });

    for (let i = 0; i < config.accounts.length; i++) {
        const account = config.accounts[i];
        const port = freePorts[i];

        try {
            // Get or create profile for this account
            const profileId = await getOrCreateAdsPowerProfile(adsClient, account);
            console.log(`Using AdsPower profile ${profileId} for account ${account.name}`);
            const profileHash = crypto
                .createHash('sha256')
                .update(account.name)
                .digest('hex');

            const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, {recursive: true});
            }

            const startResponse = await adsClient.openBrowser(profileId, {});

            if (startResponse.code !== 0) {
                throw new Error(`Failed to start AdsPower browser: ${startResponse.msg}`);
            }

            const browser = await puppeteer.connect({
                browserWSEndpoint: startResponse.data.ws.puppeteer,
                defaultViewport: null
            });

            // Open a new tab
            const page = await browser.newPage();

            // Navigate to your local server
            await page.goto(`http://127.0.0.1:${port}`);

            console.log(`Successfully launched AdsPower browser for account: ${account.name} (profile: ${profileId})`);
        } catch (error) {
            console.error(`Error starting AdsPower browser for account ${account.name}:`, error);
        }
    }
}

module.exports = {startWithChrome, startWithAdsPower};
