const fs = require('fs');
const path = require('path');
const url = require('url');
const cors = require('cors');
const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const {v4: uuidv4} = require('uuid');

const config = require(path.join(__dirname, "..", process.env.CONFIG));
const {logger} = require('../utils/utils');
const {
    handleSubscriptions,
    handleRobotsTxt,
    handleBackendApiMe,
    handleBackendApiCreatorProfile,
    handleGetModels,
    handleChatRequirements,
    handleStopGeneration, handleSidebar, handleImagesBootstrap, handleGizmosBootstrap, handleMyRecentImageGen,
    handleApiAuthSession
} = require('./reverseproxy_specialhandlers');

const {
    verifyToken,
    generateToken,
    saveToken,
    checkConversationAccess,
    listUserConversations,
    addConversationAccess,
    getInternalAuthenticationToken,
    addGizmoAccess,
    listUserGizmos,
    verifyIntegrationApiKey,
    getTokenInfo,
    callWebhook
} = require('./auth');

const {mockSuccessDomains, mockSuccessPaths, bannedPaths, domainsToProxy} = require('../consts');
const {HttpsProxyAgent} = require("https-proxy-agent");
const {workers, getAllAccounts} = require("../state/state");

const mimeTypes = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
};

const cookieMaxAge = 100 * 365 * 24 * 60 * 60 * 1000;

function startReverseProxy({doWork, handleMetrics, performDegradationCheckForAccount}) {
    const app = express();


    app.use(express.static("./static/frontend"));

    // Use cookie parser globally
    app.use(cookieParser());
    app.use(cors());

    app.get('/metrics', async (req, res) => {
        return await handleMetrics(req, res, {doWork});
    })
    app.get('/api/trigger-degradation-check', async (req, res) => {
        try {
            // Check authentication
            const token = req.headers['x-internal-authentication'] || req.cookies?.access_token;
            const isValid = token === getInternalAuthenticationToken() || await verifyToken(token);

            if (!isValid) {
                res.status(401).json({error: 'Authentication required'});
                return;
            }

            // Check if a specific account name was provided
            const targetAccountName = req.query.accountName;
            let accounts = [];

            if (targetAccountName) {
                // Find the specific account by name
                const account = getAllAccounts().find(acc => acc.name === targetAccountName);
                if (!account) {
                    return res.status(404).json({
                        error: 'Account not found',
                        message: `No account found with name: ${targetAccountName}`
                    });
                }
                accounts = [account];
            } else {
                // If no specific account provided, check all accounts
                accounts = [...getAllAccounts()];
            }

            const results = [];

            // Schedule checks for each account with random delay
            for (const account of accounts) {
                const delaySeconds = accounts.length === 1 ? 0 : Math.floor(Math.random() * (30 - 10 + 1) + 10); // Random 10-30 seconds
                const delayMs = delaySeconds * 1000;
                results.push({
                    account: account.name,
                    scheduledDelay: `${delaySeconds} seconds`
                });

                setTimeout(async () => {
                    try {
                        await performDegradationCheckForAccount(account);
                        console.log(`Manually triggered degradation check completed for ${account.name}`);
                    } catch (error) {
                        console.error(`Manually triggered degradation check failed for ${account.name}:`, error);
                    }
                }, delayMs);
            }

            res.status(200).json({
                success: true,
                message: targetAccountName
                    ? `Scheduled degradation check for account: ${targetAccountName}`
                    : `Scheduled degradation checks for ${accounts.length} accounts`,
                scheduledChecks: results
            });
        } catch (error) {
            console.error('Error triggering degradation checks:', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });
    app.get('/start', async (req, res) => {
        try {
            if (req.query.token) {
                res.cookie('access_token', req.query.token, {
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    httpOnly: false,
                    sameSite: 'lax',
                    path: '/'
                });
                res.cookie('account_name', req.query.account, {
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    httpOnly: false,
                    sameSite: 'lax',
                    path: '/'
                });
                return res.redirect('/');
            }

            // Check if user is already authenticated
            let isValidToken = false;
            try {
                isValidToken = await verifyToken(req.cookies?.access_token);
            } catch (e) {
                /* ignore */
            }

            if (isValidToken) {
                return res.redirect('/');
            }

            const passcode = req.query.passcode;
            if (passcode !== config.centralServer.auth.passcode) {
                res.writeHead(401, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({error: 'Invalid passcode'}));
            }

            // Generate a new token
            const token = generateToken();

            // Save token to database
            await saveToken(token);

            // Set cookie
            res.cookie('access_token', req.query.token, {
                maxAge: 30 * 24 * 60 * 60 * 1000,
                httpOnly: false,
                sameSite: 'lax',
                path: '/'
            });
            // Redirect to home
            return res.redirect('/');
        } catch (error) {
            console.error('Error creating new user:', error);
            res.writeHead(500, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: 'Internal server error'}));
        }
    });

    app.post('/create-managed-user', async (req, res) => {
        try {
            // Check authorization using the integration API key
            const apiKey = req.headers['x-api-key'];
            if (!verifyIntegrationApiKey(apiKey)) {
                res.status(401).json({error: 'Invalid API key'});
                return;
            }

            // Get JSON body
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }

            let body = {};
            try {
                if (chunks.length > 0) {
                    body = JSON.parse(Buffer.concat(chunks).toString());
                }
            } catch (e) {
                res.status(400).json({error: 'Invalid JSON body'});
                return;
            }

            // Extract webhook URL if provided
            const webhookUrl = body.webhook_url || null;

            // Generate a new token
            const token = generateToken();

            // Save token to database as managed user
            await saveToken(token, webhookUrl, 1);

            // Return the token
            res.status(201).json({
                token,
            });
        } catch (error) {
            logger.error('Error creating managed user:', error);
            res.status(500).json({error: 'Internal server error'});
        }
    });


    app.get('/switch-account/:name', (req, res) => {
        const accountName = req.params.name;
        res.cookie('account_name', accountName, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: false,
            sameSite: 'lax',
            path: '/'
        });

        const accounts = getAllAccounts();
        if (!accounts.some(account => account.name === accountName)) {
            res.status(400).send(`Account ${accountName} not found`);
            return;
        }

        res.send(`Switched to account: ${accountName}`);
    });

    app.get('/accounts', (req, res) => {
        const {getAllAccounts} = require('../state/state');
        const {accountStatusMap} = require('../degradation');
        const accounts = getAllAccounts();
        res.send(accounts.map(x => {
            const accountState = accountStatusMap[x.name];
            const degradation = accountState?.lastDegradationResult ? accountState?.lastDegradationResult.degradation : null;
            const load = calculateAccountLoad(x.name);
            return {
                name: x.name,
                labels: x.labels || {},
                degradation: degradation, // 0 is no degradation, 1 is slightly degraded, 2 is severely degraded
                load: load // 0 to 100, based on usage in the past 3 hours
            };
        }));
    });

    /**
     * Handle all other routes (the "fallback") exactly as in original code
     */
    app.all('*', async (req, res) => {
        const accountName = req.headers['x-account-name'] || req.cookies['account_name'];
        const selectedAccount = getSelectedAccount(accountName);
        if (!selectedAccount) {
            return res.redirect('/accountswitcher');
        }
        delete req.headers['x-account-name'];
        delete req.cookies['account_name'];

        try {
            // replicate your original "serve static" logic
            if (req.url.length > 5 && !req.url.includes('..')) {
                const filePath = path.join(__dirname, '../static', req.url);
                if (fs.existsSync(filePath)) {
                    const ext = path.extname(filePath);
                    const contentType = (mimeTypes[ext] || 'text/plain') + '; charset=utf8';

                    if (['.js', '.html', '.css', '.txt'].includes(ext)) {
                        fs.readFile(filePath, 'utf8', (err, data) => {
                            if (err) {
                                res.writeHead(500, {'Content-Type': 'text/plain; charset=utf8'});
                                res.end('Internal Server Error');
                                return;
                            }
                            // Replace the placeholder with the config value
                            const output = data.replace(/__INJECT_ANNOUNCEMENT_URL__/g, config?.announcement?.url || '');
                            res.writeHead(200, {'Content-Type': contentType});
                            res.end(output);
                        });
                    } else {
                        // Serve other static files (non-text) directly
                        res.writeHead(200, {'Content-Type': contentType});
                        fs.createReadStream(filePath).pipe(res);
                    }
                    return;
                }
            }

            // Parse the requested URL
            const parsedUrl = url.parse(req.url, true);

            // Everything beyond /start requires auth
            // --> We replicate your original token verification
            // and banned path logic
            const token = req.cookies?.access_token;

            // Check if path is banned
            const isBannedPath = bannedPaths.some((bp) => parsedUrl.pathname.match(new RegExp(bp)));
            const isOperationToAllConversations =
                req.method !== 'GET' && parsedUrl.pathname.endsWith('backend-api/conversations');
            if (isBannedPath || isOperationToAllConversations) {
                res.writeHead(401, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({error: 'Forbidden'}));
            }

            if (req.headers['x-internal-authentication'] === getInternalAuthenticationToken()) {
                // Allow internal authentication
            } else {
                // Verify token
                const isValid = await verifyToken(token);
                if (!isValid) {
                    res.writeHead(401, {'Content-Type': 'application/json'});
                    return res.end(JSON.stringify({error: 'Authentication required'}));
                }
            }

            // Handle special endpoints from the original code:

            // 1) Stop generation
            if (
                req.method === 'POST' &&
                parsedUrl.pathname.startsWith('/stop-generation/')
            ) {
                handleStopGeneration(parsedUrl.pathname.split("/").pop(), res);
                return;
            }

            // 2) Subscriptions
            if (parsedUrl.pathname.endsWith('/backend-api/subscriptions')) {
                return handleSubscriptions(req, res);
            }

            // 3) /backend-api/sentinel/chat-requirements
            if (parsedUrl.pathname.endsWith('/backend-api/sentinel/chat-requirements')) {
                return handleChatRequirements(req, res);
            }

            // if (parsedUrl.pathname.startsWith('/backend-api/gizmos/snorlax/sidebar')) {
            //     return handleSidebar(req, res);
            // }
            if (parsedUrl.pathname.startsWith('/backend-api/images/bootstrap')) {
                return handleImagesBootstrap(req, res);
            }
            if (parsedUrl.pathname.startsWith('/backend-api/gizmos/bootstrap')) {
                return handleGizmosBootstrap(req, res);
            }
            if (parsedUrl.pathname.startsWith('/backend-api/my/recent/image_gen')) {
                return handleMyRecentImageGen(req, res);
            }

            // 4) GET /backend-api/models
            if (parsedUrl.pathname.startsWith('/backend-api/models') && req.method === 'GET') {
                return handleGetModels(req, res);
            }

            if (parsedUrl.pathname.startsWith('/api/auth/session')) {
                return handleApiAuthSession(req, res);
            }

            // 5) /robots.txt
            if (req.url === '/robots.txt') {
                return handleRobotsTxt(req, res);
            }

            // 6) conversation streaming
            //    (both /backend-api/conversation and /backend-alt/conversation)
            if (
                req.method === 'POST' &&
                (parsedUrl.pathname === '/backend-api/conversation' ||
                    parsedUrl.pathname === '/backend-alt/conversation')
            ) {
                return handleConversation(req, res, {doWork, selectedAccount});
            }

            // If not handled yet, this is a normal request that we pass to the proxy logic
            const {targetHost, targetPath} = determineTarget(req.url);

            if (shouldMockSuccess(targetHost, targetPath)) {
                // Return the mock success JSON
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'access-control-allow-credentials': 'true',
                    'access-control-allow-origin': config.centralServer.url
                });
                return res.end(JSON.stringify({success: true}));
            }

            // Finally, pass everything else to standard proxy
            await proxyRequest(req, res, targetHost, targetPath, selectedAccount);
        } catch (err) {
            logger.error(`Error in fallback route: ${err.message}`);
            if (!res.headersSent) {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Internal server error'}));
            }
        }
    });

    /**
     * Start listening exactly as in your original code
     */
    app.listen(config.centralServer.port, config.centralServer.host, () => {
        logger.info(`Main frontend running at ${config.centralServer.url}`);
        logger.info(
            `Streaming conversation endpoints active at /backend-api/conversation and /backend-alt/conversation`
        );
        logger.info(
            `Blocking requests to: ${mockSuccessDomains.join(', ')} and paths containing: ${mockSuccessPaths.join(', ')}`
        );
    });
}

function determineTarget(requestUrl) {
    let targetHost = 'chatgpt.com';
    let targetPath = requestUrl;

    if (requestUrl.includes('assets/')) {
        targetHost = 'cdn.oaistatic.com';
    } else if (requestUrl.includes('file-') && !requestUrl.includes('backend-api')) {
        targetHost = 'files.oaiusercontent.com';
    } else if (requestUrl.includes('v1/')) {
        targetHost = 'ab.chatgpt.com';
    } else if (requestUrl.includes('sandbox')) {
        targetHost = 'web-sandbox.oaiusercontent.com';
        targetPath = targetPath.replace('sandbox/', '');
    }

    return {targetHost, targetPath};
}

function shouldMockSuccess(targetHost, targetPath) {
    if (mockSuccessDomains.includes(targetHost)) {
        return true;
    }
    for (const blockedPath of mockSuccessPaths) {
        if (targetPath.includes(blockedPath)) {
            return true;
        }
    }
    return false;
}

let cache = {};

function getSelectedAccount(accountName) {
    const allAccounts = getAllAccounts();
    return allAccounts.find(account => account.name === accountName);
}

// Global usage counter, mapping "accountName:model" -> numberOfCalls
const usageCounters = {};

// Time-based usage counter for tracking recent activity (past 3 hours)
// Structure: { accountName: { timestamp1: count1, timestamp2: count2, ... } }
const timeBasedUsageCounters = {};

/**
 * Increment usage counters.
 * @param {string} accountName
 * @param {string} model
 */
function incrementUsage(accountName, model) {
    const key = `${accountName}||${model}`;
    usageCounters[key] = (usageCounters[key] || 0) + 1;

    // Also track time-based usage for load calculation
    const timestamp = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000); // Round to 5-minute buckets
    if (!timeBasedUsageCounters[accountName]) {
        timeBasedUsageCounters[accountName] = {};
    }
    timeBasedUsageCounters[accountName][timestamp] = (timeBasedUsageCounters[accountName][timestamp] || 0) + 1;
}

/**
 * Calculate account load based on usage in the past 3 hours
 * @param {string} accountName
 * @returns {number} Load value between 0-100
 */
function calculateAccountLoad(accountName) {
    if (!timeBasedUsageCounters[accountName]) {
        return 0;
    }

    const now = Date.now();
    const threeHoursAgo = now - (3 * 60 * 60 * 1000);

    // Sum up all usage in the past 3 hours
    let recentUsage = 0;
    for (const [timestamp, count] of Object.entries(timeBasedUsageCounters[accountName])) {
        if (parseInt(timestamp) >= threeHoursAgo) {
            recentUsage += count;
        }
    }

    // Clean up old entries (older than 3 hours)
    Object.keys(timeBasedUsageCounters[accountName]).forEach(timestamp => {
        if (parseInt(timestamp) < threeHoursAgo) {
            delete timeBasedUsageCounters[accountName][timestamp];
        }
    });

    // Use arctan function to map usage to a 0-100 scale
    // arctan(x/50) * (2/π) * 100 gives a nice curve that reaches ~50 at x=50 and approaches 100 asymptotically
    const load = Math.round(Math.atan(recentUsage / 50) * (2 / Math.PI) * 100);
    return load;
}

const getHttpsProxyAgentCache = {};

function getHttpsProxyAgent(selectedAccount) {
    if (!getHttpsProxyAgentCache[selectedAccount.proxy]) {
        getHttpsProxyAgentCache[selectedAccount.proxy] = new HttpsProxyAgent(selectedAccount.proxy);
    }
    console.log("selected proxy", selectedAccount.proxy);
    return getHttpsProxyAgentCache[selectedAccount.proxy];
}

/**
 * The main proxy handler
 */
async function proxyRequest(req, res, targetHost, targetPath, selectedAccount) {
    try {
        // Prepare headers for the outgoing request
        const headers = {...req.headers};
        delete headers.host;
        headers.host = targetHost;
        headers['accept-encoding'] = 'identity';
        delete headers['if-modified-since'];
        delete headers['if-none-match'];
        delete headers['x-real-ip'];
        delete headers['x-forwarded-for'];

        const canCache = targetHost === 'cdn.oaistatic.com' && targetPath.includes("/assets/");
        const cacheKey = `${req.method}:${targetHost}:${targetPath}`;
        if (cache[cacheKey] && canCache) {
            res.writeHead(200, cache[cacheKey].headers);
            res.end(cache[cacheKey].body);
            return;
        }

        if (headers['origin']) {
            headers['origin'] = 'https://chatgpt.com';
        }

        if (headers['referer']) {
            delete headers['referer'];
        }

        // Add authorization
        headers['authorization'] = `Bearer ${selectedAccount.accessToken}`;
        headers['cookie'] = `__Secure-next-auth.session-token=${selectedAccount.cookie}`;

        // Determine if this is a streaming request
        const isStreamRequest = targetPath.includes('/stream');

        // We must gather request body as a buffer
        const requestChunks = [];
        for await (const chunk of req) {
            requestChunks.push(chunk);
        }
        const requestBodyBuffer = Buffer.concat(requestChunks);

        const axiosConfig = {
            method: req.method,
            url: `https://${targetHost}${targetPath}`,
            headers: headers,
            httpsAgent: getHttpsProxyAgent(selectedAccount),
            responseType: isStreamRequest ? 'stream' : 'arraybuffer',
            maxRedirects: 5,
            validateStatus: null // Accept all status codes
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            axiosConfig.data = requestBodyBuffer;
        }

        const response = await axios(axiosConfig);

        // Process response headers
        const responseHeaders = {...response.headers};
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['set-cookie'];
        delete responseHeaders['content-length'];
        responseHeaders['access-control-allow-origin'] = config.centralServer.url;

        if (isStreamRequest) {
            // For streaming responses:
            res.writeHead(response.status, responseHeaders);
            response.data.pipe(res);
            response.data.on('error', (err) => {
                console.error('Proxy stream error:', err);
                res.end();
            });
        } else {
            // Non-streaming response:
            const contentType = responseHeaders['content-type'] || '';
            const isTextResponse =
                contentType.includes('text') ||
                contentType.includes('json') ||
                contentType.includes('javascript') ||
                contentType.includes('xml') ||
                contentType.includes('html') ||
                contentType.includes('css');

            const buffer = response.data;

            const parsedUrl = url.parse(req.url, true);
            if (isTextResponse) {
                const serverUrlWithoutProtocol = config.centralServer.url.replace(/^https?:\/\//, '');
                let modifiedContent = buffer.toString();

                if (
                    req.method === 'POST' &&
                    parsedUrl.pathname.endsWith('/backend-api/gizmos/snorlax/upsert')
                ) {
                    const gizmoId = JSON.parse(modifiedContent).resource.gizmo.id;
                    await addGizmoAccess(gizmoId, req.cookies?.access_token);
                }
                // Replace all CDN domains with proxy paths
                domainsToProxy.forEach((domain) => {
                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(https?://)${domain}`, 'g'),
                        config.centralServer.url
                    );

                    // Also handle cases where URLs might be relative or without protocol
                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(["'])//${domain}`, 'g'),
                        `$1//${serverUrlWithoutProtocol}`
                    );
                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(["'])${domain}`, 'g'),
                        `$1${serverUrlWithoutProtocol}`
                    );
                });

                modifiedContent = modifiedContent.replaceAll(
                    's.gravatar.com',
                    ''
                );

                modifiedContent = modifiedContent.replaceAll(
                    'https://' + serverUrlWithoutProtocol,
                    config.centralServer.url
                );

                modifiedContent = modifiedContent.replaceAll(
                    'http://' + serverUrlWithoutProtocol,
                    config.centralServer.url
                );


                // Remove real credentials
                modifiedContent = modifiedContent.replace(selectedAccount.accessToken, '');
                modifiedContent = modifiedContent.replace(selectedAccount.cookie, '');

                // Hard-code read-aloud: L("1923022511")?.value -> true
                modifiedContent = modifiedContent.replace('L("1923022511")?.value', 'true');

                modifiedContent = modifiedContent.replace(
                    'M8.85719 3L13.5 3C14.0523 3 14.5 3.44772 14.5 4C14.5 4.55229 14.0523 5 13.5 5H11.5V19H15.1C16.2366 19 17.0289 18.9992 17.6458 18.9488C18.2509 18.8994 18.5986 18.8072 18.862 18.673C19.4265 18.3854 19.8854 17.9265 20.173 17.362C20.3072 17.0986 20.3994 16.7509 20.4488 16.1458C20.4992 15.5289 20.5 14.7366 20.5 13.6V11.5C20.5 10.9477 20.9477 10.5 21.5 10.5C22.0523 10.5 22.5 10.9477 22.5 11.5V13.6428C22.5 14.7266 22.5 15.6008 22.4422 16.3086C22.3826 17.0375 22.2568 17.6777 21.955 18.27C21.4757 19.2108 20.7108 19.9757 19.77 20.455C19.1777 20.7568 18.5375 20.8826 17.8086 20.9422C17.1008 21 16.2266 21 15.1428 21H8.85717C7.77339 21 6.89925 21 6.19138 20.9422C5.46253 20.8826 4.82234 20.7568 4.23005 20.455C3.28924 19.9757 2.52433 19.2108 2.04497 18.27C1.74318 17.6777 1.61737 17.0375 1.55782 16.3086C1.49998 15.6007 1.49999 14.7266 1.5 13.6428V10.3572C1.49999 9.27341 1.49998 8.39926 1.55782 7.69138C1.61737 6.96253 1.74318 6.32234 2.04497 5.73005C2.52433 4.78924 3.28924 4.02433 4.23005 3.54497C4.82234 3.24318 5.46253 3.11737 6.19138 3.05782C6.89926 2.99998 7.77341 2.99999 8.85719 3ZM9.5 19V5H8.9C7.76339 5 6.97108 5.00078 6.35424 5.05118C5.74907 5.10062 5.40138 5.19279 5.13803 5.32698C4.57354 5.6146 4.1146 6.07354 3.82698 6.63803C3.69279 6.90138 3.60062 7.24907 3.55118 7.85424C3.50078 8.47108 3.5 9.26339 3.5 10.4V13.6C3.5 14.7366 3.50078 15.5289 3.55118 16.1458C3.60062 16.7509 3.69279 17.0986 3.82698 17.362C4.1146 17.9265 4.57354 18.3854 5.13803 18.673C5.40138 18.8072 5.74907 18.8994 6.35424 18.9488C6.97108 18.9992 7.76339 19 8.9 19H9.5ZM5 8.5C5 7.94772 5.44772 7.5 6 7.5H7C7.55229 7.5 8 7.94772 8 8.5C8 9.05229 7.55229 9.5 7 9.5H6C5.44772 9.5 5 9.05229 5 8.5ZM5 12C5 11.4477 5.44772 11 6 11H7C7.55229 11 8 11.4477 8 12C8 12.5523 7.55229 13 7 13H6C5.44772 13 5 12.5523 5 12Z',
                    `M8.85719 3H15.1428C16.2266 2.99999 17.1007 2.99998 17.8086 3.05782C18.5375 3.11737 19.1777 3.24318 19.77 3.54497C20.7108 4.02433 21.4757 4.78924 21.955 5.73005C22.2568 6.32234 22.3826 6.96253 22.4422 7.69138C22.5 8.39925 22.5 9.27339 22.5 10.3572V13.6428C22.5 14.7266 22.5 15.6008 22.4422 16.3086C22.3826 17.0375 22.2568 17.6777 21.955 18.27C21.4757 19.2108 20.7108 19.9757 19.77 20.455C19.1777 20.7568 18.5375 20.8826 17.8086 20.9422C17.1008 21 16.2266 21 15.1428 21H8.85717C7.77339 21 6.89925 21 6.19138 20.9422C5.46253 20.8826 4.82234 20.7568 4.23005 20.455C3.28924 19.9757 2.52433 19.2108 2.04497 18.27C1.74318 17.6777 1.61737 17.0375 1.55782 16.3086C1.49998 15.6007 1.49999 14.7266 1.5 13.6428V10.3572C1.49999 9.27341 1.49998 8.39926 1.55782 7.69138C1.61737 6.96253 1.74318 6.32234 2.04497 5.73005C2.52433 4.78924 3.28924 4.02433 4.23005 3.54497C4.82234 3.24318 5.46253 3.11737 6.19138 3.05782C6.89926 2.99998 7.77341 2.99999 8.85719 3ZM6.35424 5.05118C5.74907 5.10062 5.40138 5.19279 5.13803 5.32698C4.57354 5.6146 4.1146 6.07354 3.82698 6.63803C3.69279 6.90138 3.60062 7.24907 3.55118 7.85424C3.50078 8.47108 3.5 9.26339 3.5 10.4V13.6C3.5 14.7366 3.50078 15.5289 3.55118 16.1458C3.60062 16.7509 3.69279 17.0986 3.82698 17.362C4.1146 17.9265 4.57354 18.3854 5.13803 18.673C5.40138 18.8072 5.74907 18.8994 6.35424 18.9488C6.97108 18.9992 7.76339 19 8.9 19H9.5V5H8.9C7.76339 5 6.97108 5.00078 6.35424 5.05118ZM11.5 5V19H15.1C16.2366 19 17.0289 18.9992 17.6458 18.9488C18.2509 18.8994 18.5986 18.8072 18.862 18.673C19.4265 18.3854 19.8854 17.9265 20.173 17.362C20.3072 17.0986 20.3994 16.7509 20.4488 16.1458C20.4992 15.5289 20.5 14.7366 20.5 13.6V10.4C20.5 9.26339 20.4992 8.47108 20.4488 7.85424C20.3994 7.24907 20.3072 6.90138 20.173 6.63803C19.8854 6.07354 19.4265 5.6146 18.862 5.32698C18.5986 5.19279 18.2509 5.10062 17.6458 5.05118C17.0289 5.00078 16.2366 5 15.1 5H11.5ZM5 8.5C5 7.94772 5.44772 7.5 6 7.5H7C7.55229 7.5 8 7.94772 8 8.5C8 9.05229 7.55229 9.5 7 9.5H6C5.44772 9.5 5 9.05229 5 8.5ZM5 12C5 11.4477 5.44772 11 6 11H7C7.55229 11 8 11.4477 8 12C8 12.5523 7.55229 13 7 13H6C5.44772 13 5 12.5523 5 12Z`
                );
                modifiedContent = modifiedContent.replace(
                    '{cx:20,cy:5,r:4,fill:"#0285FF"}',
                    `{cx:20,cy:5,r:4,fill:"#00000000"}`
                );
                modifiedContent = modifiedContent.replace(
                    '{d:"M14.9998 7.5C14.9998 5.01472 17.0145 3 19.4998 3C21.985 3 23.9998 5.01472 23.9998 7.5C23.9998 9.98528 21.985 12 19.4998 12C17.0145 12 14.9998 9.98528 14.9998 7.5Z",fill:"#007AFF"}',
                    `{d:"M14.9998 7.5C14.9998 5.01472 17.0145 3 19.4998 3C21.985 3 23.9998 5.01472 23.9998 7.5C23.9998 9.98528 21.985 12 19.4998 12C17.0145 12 14.9998 9.98528 14.9998 7.5Z",fill:"#00000000"}`
                );
                modifiedContent = modifiedContent.replace(
                    'M13.0187 7C13.0061 7.16502 12.9998 7.33176 12.9998 7.5C12.9998 8.01627 13.0599 8.51848 13.1737 9H4C3.44772 9 3 8.55228 3 8C3 7.44772 3.44772 7 4 7H13.0187ZM15.0272 7C15.0091 7.16417 14.9998 7.331 14.9998 7.5C14.9998 8.02595 15.09 8.53083 15.2558 9H20C20.5523 9 21 8.55228 21 8C21 7.44772 20.5523 7 20 7H15.0272ZM4 15C3.44772 15 3 15.4477 3 16C3 16.5523 3.44772 17 4 17H14C14.5523 17 15 16.5523 15 16C15 15.4477 14.5523 15 14 15H4Z',
                    `M3 8C3 7.44772 3.44772 7 4 7H20C20.5523 7 21 7.44772 21 8C21 8.55228 20.5523 9 20 9H4C3.44772 9 3 8.55228 3 8ZM3 16C3 15.4477 3.44772 15 4 15H14C14.5523 15 15 15.4477 15 16C15 16.5523 14.5523 17 14 17H4C3.44772 17 3 16.5523 3 16Z`
                );
                if (process.env.REDACT_EMAIL) {
                    modifiedContent = modifiedContent.replace(
                        process.env.REDACT_EMAIL,
                        `sama@openai.com`
                    );
                }
                modifiedContent = modifiedContent.replace(
                    new RegExp('subscriptionExpiresAt\\\\",\\d+'),
                    `subscriptionExpiresAt\\",4102329599`
                );

                if (
                    req.method === 'GET'
                ) {
                    modifiedContent = modifiedContent.replace(
                        '</head>',
                        '<script src="/assets/inject-script.js"></script></head>',
                    );
                    modifiedContent = modifiedContent.replace(
                        '</head>',
                        '<script src="/assets/announcement.js"></script></head>',
                    );
                }

                // Handle /backend-api/me
                if (targetPath.endsWith('backend-api/me')) {
                    return handleBackendApiMe(req, res);
                }

                // Handle /backend-api/gizmo_creator_profile
                if (targetPath.endsWith('backend-api/gizmo_creator_profile')) {
                    return handleBackendApiCreatorProfile(req, res);
                }

                // conversation access checks
                if (req.method === 'GET') {
                    const match = /conversation\/([a-f0-9-]+)$/.exec(targetPath);
                    if (match) {
                        try {
                            await addConversationAccess(match[1], req.cookies?.access_token);
                        } catch (ignored) {
                            /* ignore */
                        }
                    }
                }

                if (
                    targetPath.startsWith('/backend-api/conversation/') &&
                    !targetPath.endsWith('generate_autocompletions') &&
                    !targetPath.endsWith('download')
                ) {
                    const conversationId = targetPath.split('/conversation/')[1].split('/')[0];
                    if (req.headers['x-internal-authentication'] === getInternalAuthenticationToken()) {
                        // allow internal authentication
                    } else {
                        const userIdentity = req.cookies?.access_token;
                        if (!userIdentity) {
                            res.writeHead(401, {'Content-Type': 'application/json'});
                            return res.end(JSON.stringify({error: 'User identity not provided'}));
                        }

                        const hasAccess =
                            targetPath.includes('conversation/init') ||
                            targetPath.includes('conversation/voice') ||
                            (await checkConversationAccess(conversationId, userIdentity));

                        if (!hasAccess) {
                            res.writeHead(401, {'Content-Type': 'application/json'});
                            return res.end(JSON.stringify({error: 'not authorized'}));
                        }
                    }
                }

                // Filter user conversations
                if (targetPath.startsWith('/backend-api/conversations')) {
                    const userConversations = await listUserConversations(req.cookies?.access_token);
                    const ids = {};
                    for (let uc of userConversations) {
                        ids[uc.conversation_id] = true;
                    }

                    let parsed = JSON.parse(modifiedContent);

                    if (!process.env.NO_CONVERSATION_ISOLATION) {
                        if (targetPath.includes('/search?')) {
                            parsed.items = parsed.items.filter((item) => !!ids[item.conversation_id]);
                        } else {
                            parsed.items.forEach((item) => {
                                if (!ids[item.id]) {
                                    item.title = '🔐 NOT AUTHORIZED';
                                    // item.id = '00000000-0000-0000-0000-000000000000'; // don't do this for now or else ChatGPT UI will bug
                                }
                            });
                        }
                    }
                    modifiedContent = JSON.stringify(parsed);
                }

                if (targetPath.startsWith('/backend-api/gizmos/snorlax/sidebar')) {
                    const userGizmos = await listUserGizmos(req.cookies?.access_token);
                    const ids = {};
                    for (let uc of userGizmos) {
                        ids[uc.gizmo_id] = true;
                    }

                    let parsed = JSON.parse(modifiedContent);

                    if (!process.env.NO_CONVERSATION_ISOLATION) {
                        // parsed.items.forEach((item) => {
                        //     if (!ids[item.gizmo.gizmo.id]) {
                        //         item.gizmo = {
                        //             files: [],
                        //             gizmo: {
                        //                 id: '00000000-0000-0000-0000-000000000000',
                        //                 display: {
                        //                     name: '🔐 NOT AUTHORIZED',
                        //                 },
                        //             }
                        //         };
                        //     }
                        // });

                        parsed.items = parsed.items.filter((item) => !!ids[item.gizmo.gizmo.id]);
                    }
                    modifiedContent = JSON.stringify(parsed);
                }

                // Send final text response
                Object.keys(responseHeaders).forEach((key) => {
                    let value = responseHeaders[key];
                    if (key.toLowerCase().trim() === 'link') {
                        for (let domain of domainsToProxy) {
                            value = value.replace(
                                new RegExp(`(https?://)${domain}`, 'g'),
                                config.centralServer.url
                            );
                            value = value.replace(
                                new RegExp(`(["'])//${domain}`, 'g'),
                                `$1//${serverUrlWithoutProtocol}`
                            );
                            value = value.replace(
                                new RegExp(`(["'])${domain}`, 'g'),
                                `$1${serverUrlWithoutProtocol}`
                            );
                        }
                    }
                    res.setHeader(key, value);
                });

                res.writeHead(response.status);
                if (canCache && res.statusCode === 200) {
                    cache[cacheKey] = {headers: responseHeaders, body: modifiedContent};
                }
                return res.end(modifiedContent);
            } else {
                // Binary or non-text
                Object.keys(responseHeaders).forEach((key) => {
                    res.setHeader(key, responseHeaders[key]);
                });
                res.writeHead(response.status);
                if (canCache && res.statusCode === 200) {
                    cache[cacheKey] = {headers: responseHeaders, body: buffer};
                }
                return res.end(buffer);
            }
        }
    } catch (error) {
        logger.error(`Proxy request error: ${error.message}`);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end(`Proxy error: ${error.message}`);
        }
    }
}

/**
 * Streaming conversation requests
 */
function handleConversation(req, res, {doWork, selectedAccount}) {
    logger.info('Handling streaming conversation request');

    const chunks = [];
    req.on('data', (chunk) => {
        chunks.push(chunk);
    });

    req.on('end', async () => {
        try {
            // Parse request body
            let payload;
            try {
                payload = JSON.parse(Buffer.concat(chunks).toString());
            } catch (parseError) {
                logger.error(`Failed to parse request body: ${parseError.message}`);
                res.writeHead(400, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({error: 'Invalid JSON in request body'}));
            }

            const action = payload.action || '';
            const model = payload.model || '';
            const parentMessageId = payload.parent_message_id || '';
            const conversationId = payload.conversation_id || '';

            let userMessage = '';
            let preferredMessageId = '';

            const messages = payload.messages || [];
            if (messages.length > 0) {
                const latestMessage = messages[messages.length - 1];
                if (latestMessage.content && latestMessage.content.parts) {
                    userMessage = latestMessage.content.parts[0] || '';
                }
                preferredMessageId = latestMessage.id || '';
            }

            const task = {
                type: 'conversation',
                action,
                question: userMessage,
                preferred_message_id: preferredMessageId,
                model,
                parent_message_id: parentMessageId,
                conversation_id: conversationId,
                raw_payload: payload
            };

            if (task.raw_payload.action === 'variant' && !task.raw_payload.conversation_id) {
                res.writeHead(400, {'Content-Type': 'application/json'});
                return res.end(
                    JSON.stringify({
                        error: 'Invalid request, please copy your prompt, refresh the page, and send again'
                    })
                );
            }

            // Check with webhook for managed users
            const token = req.cookies?.access_token;
            if (token) {
                const webhookResult = await callWebhook(token, 'conversation_start', {
                    action: task.action,
                    model: model,
                    question: userMessage,
                    conversation_id: conversationId || null
                });

                if (!webhookResult.allowed) {
                    res.writeHead(403, {'Content-Type': 'application/json'});
                    return res.end(JSON.stringify({
                        error: webhookResult.reason || "unspecified reason",
                    }));
                }
            }

            logger.info('assigning conversation task to worker', userMessage);
            incrementUsage(selectedAccount.name, model);

            try {
                await doWork(task, req, res, selectedAccount);
            } catch (e) {
                if (!res.headersSent) {
                    res.writeHead(500, {'Content-Type': 'application/json'});
                    return res.end(JSON.stringify({error: e.toString()}));
                }
            }
        } catch (error) {
            logger.error(`Error handling conversation request: ${error.message}`);
            if (!res.headersSent) {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: `Request processing error: ${error.message}`}));
            }
        }
    });

    req.on('error', (error) => {
        logger.error(`Request error: ${error.message}`);
        if (!res.headersSent) {
            res.writeHead(500, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: `Request error: ${error.message}`}));
        }
    });
}

module.exports = {usageCounters, startReverseProxy, calculateAccountLoad, timeBasedUsageCounters};
