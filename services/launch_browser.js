const {spawn} = require("child_process");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");
const findGitRoot = require("find-git-root");

const config = require(path.join(__dirname, "..", process.env.CONFIG));
const AdsPowerClient = require("./adspower");
const {runMitm} = require("./mitmproxy");
const {rimraf} = require("rimraf");
const gitRoot = findGitRoot(".");

//
// We keep track of running instances so we can close/restart them.
// Key = account.name, Value = object with references
//
const chromeInstances = new Map();   // { child, server }
const adsPowerInstances = new Map(); // { profileId, browser, server }


//
// Helper to get or create an AdsPower profile for an account
//
async function getOrCreateAdsPowerProfile(adsClient, account, port) {
    // Create a unique hash for this account to use as profile name
    const profileHash = crypto
        .createHash("sha256")
        .update(account.name)
        .digest("hex")
        .substring(0, 8);

    const random = crypto.randomBytes(4).toString("hex");
    const profileName = `${account.name} (${profileHash}:${random})`;

    // Build the expected proxy configuration for this account
    const expectedProxyConfig = {
        proxy_soft: "other",
        proxy_type: "http",
        proxy_host: "127.0.0.1",
        proxy_port: port,
        proxy_user: "",
        proxy_password: "",
    };

    // 1. Check for an existing profile
    try {
        console.log(`[AdsPower] Checking for existing profile for account: ${account.name}`);
        const listResponse = await adsClient.listProfiles(config.adspower.groupId);
        if (listResponse.code === 0 && listResponse.data?.list) {
            const existingProfile = listResponse.data.list.find(
                (profile) => profile.name.startsWith(profileName.split(':')[0])
            );
            if (existingProfile && existingProfile.profile_id) {
                console.log(
                    `[AdsPower] Found existing profile for account: ${account.name}`
                );

                try {
                    const updateResponse = await adsClient.updateProfile({
                        profile_id: existingProfile.profile_id,
                        user_proxy_config: expectedProxyConfig,
                    });
                    if (updateResponse.code !== 0) {
                        throw new Error(
                            `API responded with code ${updateResponse.code}: ${updateResponse.msg}`
                        );
                    }
                    console.log(
                        `[AdsPower] Successfully updated proxy settings for profile ${existingProfile.profile_id}`
                    );
                } catch (updateErr) {
                    console.warn(
                        `[AdsPower] Failed to update proxy settings for profile ${existingProfile.profile_id}: ${updateErr.message}`
                    );
                }

                // Return the existing profile ID
                return existingProfile.profile_id;
            }
        }
    } catch (error) {
        console.warn(`[AdsPower] Error while listing profiles: ${error.message}`);
        // Fall through to create profile
    }

    // 2. Create a fresh one if not found
    console.log(`[AdsPower] Creating new profile for account: ${account.name} (${profileHash})`);
    const createResponse = await adsClient.createProfile({
        name: profileName,
        groupId: config.adspower.groupId,
        proxyConfig: expectedProxyConfig,
        fingerprintConfig: {},
    });

    if (createResponse.code !== 0) {
        throw new Error(`Failed to create AdsPower profile: ${createResponse.msg}`);
    }
    return createResponse.data.profile_id;
}

/**
 * Start a single account with *regular Chrome*.
 * - Creates a local ephemeral HTTP server
 * - Spawns Chrome
 * - Navigates to server
 * - Waits for Chrome to exit
 *
 * @param {Object} account
 * @returns {Promise<void>}
 */
function startWithChrome(account) {
    return new Promise(async (resolve, reject) => {

        const {port, closeServer} = await runMitm(account);

        const profileHash = crypto
            .createHash("sha256")
            .update(account.name)
            .digest("hex");
        const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, {recursive: true});
        }

        const chromeArgs = [
            `--user-data-dir=${userDataDir}`,
            `--proxy-server=http://127.0.0.1:${port}`,
            `--disable-extensions-except=${path.resolve(gitRoot, "..", "chrome-extension")}`,
            `--load-extension=${path.resolve(gitRoot, "..", "chrome-extension")}`,
            "--allow-insecure-localhost",
            "--ignore-urlfetcher-cert-requests",
            "--force-dark-mode",
            "--no-sandbox",
            "--ignore-certificate-errors",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--disable-breakpad",
            "--metrics-recording-only",
            "--safebrowsing-disable-auto-update",
            "--disable-crash-reporter",
            "--disable-default-apps",
            "--no-default-browser-check",
            "--no-first-run",
            "--disable-infobars",
            "--disable-popup-blocking",
            "--disable-sync",
            "--disable-translate",
            "--password-store=basic",
            "--disable-features=CalculateNativeWinOcclusion",
            "--disable-blink-features=AutomationControlled",
            "--disable-renderer-backgrounding",
            "--force-color-profile=srgb",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-ipc-flooding-protection",
        ];

        if (os.platform() === "darwin") {
            chromeArgs.push("--use-mock-keychain");
        }

        console.log(`Launching Chrome for account "${account.name}"...`);
        const child = spawn(config.chrome.bin, [...chromeArgs, `http://127.0.0.1:${port}/setup-extension`], {
            stdio: "inherit",
        });

        // Store references so we can close or restart later
        chromeInstances.set(account.name, {child, closeServer});

        child.on("error", (err) => {
            console.error(`Failed to launch Chrome for ${account.name}:`, err);
            closeServer();
            reject(err);
        });

        child.on("exit", (code) => {
            console.log(`Chrome for ${account.name} exited with code ${code}`);
            closeServer();
            resolve();
        });
    });
}

/**
 * Stop a running Chrome instance for the given account (if any).
 * - Kills the child process
 * - Closes the ephemeral server
 *
 * @param {Object} account
 * @returns {Promise<void>}
 */
function stopChrome(account) {
    const instance = chromeInstances.get(account.name);
    if (instance) {
        console.log(`Stopping Chrome for account "${account.name}"...`);
        const {child, closeServer} = instance;
        closeServer();
        child.kill("SIGTERM");
        chromeInstances.delete(account.name);
    }
}

/**
 * Restart Chrome for the given account:
 * - Stop if it exists
 * - Start a fresh instance
 *
 * @param {Object} account
 * @returns {Promise<void>}
 */
async function restartChrome(account) {
    await stopChrome(account);
    await startWithChrome(account);
}

/**
 * Start a single account with *AdsPower*.
 * - Creates ephemeral server
 * - Opens AdsPower browser profile via Puppeteer
 * - Navigates to local config page
 * - Waits for close
 */
async function startWithAdsPower(account) {
    return new Promise(async (resolve, reject) => {
        const {port, closeServer} = await runMitm(account);


        const adsClient = new AdsPowerClient({
            baseUrl: config.adspower.baseUrl,
            apiKey: config.adspower.apiKey,
        });

        try {
            // Get or create the AdsPower profile for this account
            const profile_id = await getOrCreateAdsPowerProfile(adsClient, account, port);
            console.log(`[AdsPower] Using profile ${profile_id} for account "${account.name}"`);

            // Start the AdsPower browser
            const startResponse = await adsClient.openBrowser(profile_id, {});
            if (startResponse.code !== 0) {
                throw new Error(`Failed to start AdsPower browser: ${startResponse.msg}`);
            }

            // Connect Puppeteer
            const browser = await puppeteer.connect({
                browserWSEndpoint: startResponse.data.ws.puppeteer,
                defaultViewport: null,
            });

            // Store references so we can close or restart later
            adsPowerInstances.set(account.name, {
                closeServer,
            });

            // Open a new page, navigate to our ephemeral server
            const page = await browser.newPage();
            await page.goto(`http://127.0.0.1:${port}/setup-extension`);
            console.log(`AdsPower browser for "${account.name}" opened local config page.`);

            // Listen for the browser close event
            browser.on("disconnected", () => {
                console.log(`AdsPower browser for ${account.name} disconnected/closed.`);
                closeServer();
                adsPowerInstances.delete(account.name);
                resolve();
            });
        } catch (error) {
            console.error(`Error starting AdsPower browser for ${account.name}:`, error);
            closeServer();
            adsPowerInstances.delete(account.name);
            reject(error);
        }
    });

}

/**
 * Stop (close) a running AdsPower browser for the given account (if any).
 * - Uses adsClient.closeBrowser(profileId)
 * - Closes Puppeteer browser
 * - Closes ephemeral server
 */
async function stopAdsPower(account) {
    const instance = adsPowerInstances.get(account.name);
    if (instance) {
        const {closeServer} = instance;
        closeServer();
        adsPowerInstances.delete(account.name);
    }

    console.log(`Stopping AdsPower for account "${account.name}"`);

    // We need a fresh AdsPower client to call closeBrowser
    const adsClient = new AdsPowerClient({
        baseUrl: config.adspower.baseUrl,
        apiKey: config.adspower.apiKey,
    });

    // Attempt to close via the AdsPower API
    try {
        const listResponse = await adsClient.listProfiles(config.adspower.groupId);
        if (listResponse.code === 0 && listResponse.data?.list) {
            for (let profile of listResponse.data.list.filter((profile) => profile.name.startsWith(account.name))) {
                await adsClient.closeBrowser(profile.profile_id);
            }
        }
    } catch (err) {
        console.warn(`[AdsPower] Could not close browser for ${account.name}: ${err.message}`);
    }
}

/**
 * Restart an AdsPower browser for the given account:
 * - If running, closes it
 * - Then start a new instance
 */
async function restartAdsPower(account) {
    await stopAdsPower(account);
    await startWithAdsPower(account);
}


async function restartBrowser(account) {
    if (config.adspower) {
        return restartAdsPower(account);
    } else if (config.chrome) {
        return restartChrome(account);
    }
}


async function deleteAdsPower(account) {
    const adsClient = new AdsPowerClient({
        baseUrl: config.adspower.baseUrl,
        apiKey: config.adspower.apiKey,
    });

    try {
        const listResponse = await adsClient.listProfiles(config.adspower.groupId);
        if (listResponse.code === 0 && listResponse.data?.list) {
            for (let profile of listResponse.data.list.filter(
                (profile) => profile.name.startsWith(account.name)
            )) {
                await adsClient.closeBrowser(profile.profile_id);
                await adsClient.deleteBrowser(profile.profile_id);
            }
        }
    } catch (err) {
        console.warn(`[AdsPower] Could not close browser for ${account.name}: ${err.message}`);
    }
}

async function deleteChrome(account) {
    await stopChrome(account);
    const profileHash = crypto
        .createHash("sha256")
        .update(account.name)
        .digest("hex");
    const userDataDir = path.join(gitRoot, "..", "chrome-profiles", profileHash);
    if (fs.existsSync(userDataDir)) {
        rimraf.sync(userDataDir);
    }
}

async function deleteBrowser(account) {
    if (config.adspower) {
        return deleteAdsPower(account);
    } else if (config.chrome) {
        return deleteChrome(account);
    }
}

module.exports = {
    restartBrowser,
    deleteBrowser
};
