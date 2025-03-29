const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const config = require('../config');
const {logger} = require('../utils/utils');
const {
    handleSubscriptions,
    handleRobotsTxt,
    handleBackendApiMe,
    handleBackendApiCreatorProfile,
    handleStopGeneration, handleGetModels, handleChatRequirements
} = require('./reverseproxy_specialhandlers');
const cookieParser = require('cookie-parser');
const {
    verifyToken,
    generateToken,
    saveToken,
    checkConversationAccess,
    listUserConversations,
    addConversationAccess
} = require('./auth');
const {mockSuccessDomains, mockSuccessPaths, bannedPaths, domainsToProxy} = require("../consts");
const {assignTaskToWorker} = require("./worker");
const axios = require('axios');
const {httpsProxyAgent} = require("../utils/tunnel");

const cookieMaxAge = 100 * 365 * 24 * 60 * 60 * 1000;

function startReverseProxy() {
    // Create HTTP server
    const server = http.createServer((req, res) => {
        // serve static
        if (req.url.length > 5 && !req.url.includes("..")) {
            const filePath = path.join(__dirname, '../static', req.url);
            try {
                if (fs.existsSync(filePath)) {
                    fs.createReadStream(filePath).pipe(res);
                    res.writeHead(200, {'Content-Type': 'text/plain'});
                    return;
                }
            } catch (e) {
                console.log(e, req.url);
            }
        }

        cookieParser()(req, res, async () => {

            // Parse the requested URL
            const parsedUrl = url.parse(req.url, true);

            // Skip auth check for start endpoint
            if (parsedUrl.pathname === '/start') {

                let isValidToken = false;
                try {
                    isValidToken = await verifyToken(req.cookies?.auth_token);
                } catch (e) {
                }

                if (isValidToken) {
                    res.writeHead(302, {'Location': '/'});
                    res.end();
                    return;
                }

                const {passcode} = parsedUrl.query;

                // Check if passcode matches the configured passcode
                if (passcode !== config.auth.passcode) {
                    res.writeHead(403, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: `Invalid passcode`}));
                    return;
                }

                try {
                    // Generate a new token
                    const token = generateToken();

                    // Save token to database
                    await saveToken(token);

                    // Set cookie with token
                    res.setHeader('Set-Cookie', `auth_token=${token}; Max-Age=${cookieMaxAge}; HttpOnly; SameSite=Lax`);

                    // Redirect to home page
                    res.writeHead(302, {'Location': '/'});
                    res.end();
                } catch (error) {
                    console.error('Error creating new user:', error);
                    res.status(500).json({error: 'Internal server error'});
                }
                return;
            }

            // Verify authentication token for all other endpoints
            const token = req.cookies?.auth_token;

            try {
                const isBannedPath = bannedPaths.some(path => parsedUrl.pathname.match(new RegExp(path)));
                const isOperationToAllConversations = req.method !== 'GET' && parsedUrl.pathname.endsWith("backend-api/conversations");
                if (isBannedPath || isOperationToAllConversations) {
                    res.writeHead(401, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: 'Forbidden'}));
                    return false;
                }

                const isValid = await verifyToken(token);
                if (!isValid) {
                    res.writeHead(403, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: 'Authentication required'}));
                    return;
                }

                // Handle streaming conversation endpoints
                if (req.method === 'POST' &&
                    (parsedUrl.pathname === '/backend-api/conversation' ||
                        parsedUrl.pathname === '/backend-alt/conversation')) {
                    handleConversationStreaming(req, res);
                    return;
                }

                // Handle stop generation
                if (req.method === 'POST' &&
                    (parsedUrl.pathname.startsWith("/stop-generation/"))) {
                    handleStopGeneration(parsedUrl.pathname.split("/").pop(), req, res);
                    return;
                }

                if (parsedUrl.pathname.endsWith('/backend-api/subscriptions')) {
                    handleSubscriptions(req, res);
                    return;
                }

                if (parsedUrl.pathname.endsWith('/backend-api/sentinel/chat-requirements')) {
                    handleChatRequirements(req, res);
                    return;
                }

                if (req.url === '/robots.txt') {
                    handleRobotsTxt(req, res);
                    return;
                }

                if (req.url.startsWith('/backend-api/models') && req.method === "GET") {
                    handleGetModels(req, res);
                    return;
                }

                // Check if this is a special route that should use the secondary proxy
                if (isSpecialRoute(req.method, parsedUrl.pathname)) {
                    const targetUrl = `https://chatgpt.com${parsedUrl.pathname}`;
                    handleSpecialProxy(req, res, targetUrl);
                    return;
                }

                const {targetHost, targetPath} = determineTarget(req.url);
                if (shouldMockSuccess(targetHost, targetPath)) {
                    sendMockSuccessResponse(res);
                    return;
                }

                // Proxy the request
                proxyRequest(req, res, targetHost, targetPath);
            } catch (error) {
                logger.error(`Authentication error: ${error.message}`);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Internal server error'}));
            }
        });
    });

    server.listen(config.server.port, config.server.host, () => {
        logger.info(`Reverse proxy running at ${config.server.url}`);
        logger.info(`Streaming conversation endpoints active at /backend-api/conversation and /backend-alt/conversation`);
        logger.info(`Blocking requests to: ${mockSuccessDomains.join(', ')} and paths containing: ${mockSuccessPaths.join(', ')}`);
    });
}


function determineTarget(requestUrl) {
    let targetHost = "chatgpt.com";
    let targetPath = requestUrl;

    // Route to different domains based on path patterns
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

function sendMockSuccessResponse(res) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'access-control-allow-credentials': 'true',
        'access-control-allow-origin': config.server.url
    });
    res.end(JSON.stringify({success: true}));
}


async function proxyRequest(req, res, targetHost, targetPath) {
    try {
        // Prepare headers for the outgoing request
        const headers = {...req.headers};
        delete headers.host;
        headers.host = targetHost;
        headers['accept-encoding'] = 'identity';

        if (headers['origin']) {
            headers['origin'] = 'https://chatgpt.com';
        }

        if (headers['referer']) {
            delete headers['referer'];
        }

        // Add authorization for non-static resources
        if (!targetPath.includes("static") && !targetPath.includes("/assets/")) {
            headers['authorization'] = `Bearer ${config.proxy.authToken}`;
            headers['cookie'] = `${config.proxy.cookie}`;
        }

        // Determine if this is a streaming request
        const isStreamRequest = targetPath.includes("/stream");

        // Prepare request config
        const axiosConfig = {
            method: req.method,
            url: `https://${targetHost}${targetPath}`,
            headers: headers,
            httpsAgent: httpsProxyAgent,
            responseType: isStreamRequest ? 'stream' : 'arraybuffer',
            maxRedirects: 5,
            validateStatus: null // Accept all status codes to handle them ourselves
        };

        // Handle request body for non-GET/HEAD requests
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            const requestChunks = [];

            for await (const chunk of req) {
                requestChunks.push(chunk);
            }

            axiosConfig.data = Buffer.concat(requestChunks);
        }

        const response = await axios(axiosConfig);

        // Process response headers
        const responseHeaders = {...response.headers};
        delete responseHeaders['content-security-policy'];
        delete responseHeaders['set-cookie'];
        responseHeaders['access-control-allow-origin'] = config.server.url;

        if (isStreamRequest) {
            // For streaming responses
            res.writeHead(response.status, responseHeaders);

            // Pipe the stream to the client response
            response.data.pipe(res);

            // Handle stream errors
            response.data.on('error', (err) => {
                console.error('Proxy stream error:', err);
                res.end();
            });
        } else {
            // For non-streaming responses
            const contentType = responseHeaders['content-type'] || '';
            const isTextResponse = contentType.includes('text') ||
                contentType.includes('json') ||
                contentType.includes('javascript') ||
                contentType.includes('xml') ||
                contentType.includes('html') ||
                contentType.includes('css');

            // Get response data as buffer
            const buffer = response.data;

            if (isTextResponse) {
                // For text responses, replace domain references
                let content = buffer.toString();
                let modifiedContent = content;

                // Replace all CDN domains with proxy paths
                domainsToProxy.forEach(domain => {
                    // Replace both http and https URLs
                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(https?://)${domain}`, 'g'),
                        config.server.url
                    );

                    // Also handle cases where URLs might be relative or without protocol
                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(["'])//${domain}`, 'g'),
                        `$1${config.server.url}`
                    );

                    modifiedContent = modifiedContent.replace(
                        new RegExp(`(["'])${domain}`, 'g'),
                        `$1${config.server.url}`
                    );
                });

                modifiedContent = modifiedContent.replace(
                    config.proxy.cookie,
                    ``
                );
                modifiedContent = modifiedContent.replace(
                    config.proxy.authToken,
                    ``
                );
                // feature flag for read aloud
                modifiedContent = modifiedContent.replace(
                    'L("1923022511")?.value',
                    `true`
                );
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

                if (req.method === "GET" && (req.url.split('?')[0] === "/" || /\/c\/[a-z0-9-]+$/.exec(req.url.split('?')[0]))) {
                    modifiedContent = modifiedContent.replace('</head>', '<script src="/inject-script.js"/></head>');
                }

                // Handle special endpoints
                if (targetPath.endsWith('backend-api/me')) {
                    return handleBackendApiMe(req, res);
                }
                if (targetPath.endsWith('backend-api/gizmo_creator_profile')) {
                    return handleBackendApiCreatorProfile(req, res);
                }

                // Conversation access handling
                if (req.method === "GET") {
                    let targetPathMatch = /conversation\/([a-f0-9-]+)$/.exec(targetPath);
                    if (targetPathMatch) {
                        try {
                            await addConversationAccess(targetPathMatch[1], req.cookies?.auth_token);
                        } catch (ignored) {
                        }
                    }
                }

                if (targetPath.startsWith('/backend-api/conversation/') && !targetPath.endsWith("generate_autocompletions") && !targetPath.endsWith("download")) {
                    const conversationId = targetPath.split('/conversation/')[1].split("/")[0];
                    const userIdentity = req.cookies?.auth_token;
                    if (!userIdentity) {
                        res.writeHead(403, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({error: 'User identity not provided'}));
                    }

                    const hasAccess = targetPath.includes("conversation/init") ||
                        targetPath.includes("conversation/voice") ||
                        await checkConversationAccess(conversationId, userIdentity);
                    if (!hasAccess) {
                        res.writeHead(403, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({error: 'not authorized'}));
                    }
                }

                if (targetPath.startsWith('/backend-api/conversations')) {
                    const userConversations = await listUserConversations(req.cookies?.auth_token);
                    const ids = {};
                    for (let userConversation of userConversations) {
                        ids[userConversation.conversation_id] = true;
                    }
                    let content = JSON.parse(modifiedContent);
                    if (targetPath.includes("/search?")) {
                        content.items = content.items.filter(item => {
                            return !!ids[item.conversation_id]
                        });
                    } else {
                        content.items.forEach(item => {
                            if (!ids[item.id]) {
                                item.title = "🔐 NOT AUTHORIZED";
                            }
                        });
                    }

                    modifiedContent = JSON.stringify(content);
                }

                // Set response headers (excluding content-length which we'll recalculate)
                Object.keys(responseHeaders).forEach(key => {
                    if (key.toLowerCase() !== 'content-length') {
                        res.setHeader(key, responseHeaders[key]);
                    }
                });

                res.writeHead(response.status);
                res.end(modifiedContent);
            } else {
                // For non-text responses, send the buffer directly
                Object.keys(responseHeaders).forEach(key => {
                    res.setHeader(key, responseHeaders[key]);
                });
                res.writeHead(response.status);
                res.end(buffer);
            }
        }
    } catch (error) {
        logger.error(`Proxy request error: ${error.message}`);
        res.writeHead(500);
        res.end(`Proxy error: ${error.message}`);
    }
}

function isSpecialRoute(method, path) {
    if (method === "POST" && path === '/backend-api/conversation') {
        return true;
    }
    if (method === "GET" && path.includes('/backend-api/models')) {
        return true;
    }
    return false;
}

async function handleSpecialProxy(req, res, targetUrl) {
    try {
        const task = {
            type: "fetch",
            request: {url: targetUrl}
        };

        const result = assignTaskToWorker(task, res);
        if (result.error) {
            res.writeHead(500, {'Content-Type': 'application/json'});
            return res.end(JSON.stringify({error: result.error}));
        }
    } catch (error) {
        logger.error(`Special proxy error: ${error.message}`);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({
            error: 'Special proxy error',
            message: error.message
        }));
    }
}

/**
 * Handle streaming conversation requests
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
function handleConversationStreaming(req, res) {
    logger.info('Handling streaming conversation request');

    // Collect request body chunks
    const chunks = [];

    req.on('data', (chunk) => {
        chunks.push(chunk);
    });

    req.on('end', async () => {
        try {
            // Parse the request body
            const requestBody = Buffer.concat(chunks).toString();
            const payload = JSON.parse(requestBody);

            // Extract the required data
            const action = payload.action || '';
            const model = payload.model || '';
            const parentMessageId = payload.parent_message_id || '';
            const conversationId = payload.conversation_id || '';

            let userMessage = '';
            let preferredMessageId = '';

            // Extract the user message and message ID
            const messages = payload.messages || [];
            if (messages.length > 0) {
                const latestMessage = messages[messages.length - 1];
                if (latestMessage.content && latestMessage.content.parts && latestMessage.content.parts.length > 0) {
                    userMessage = latestMessage.content.parts[0] || '';
                }
                preferredMessageId = latestMessage.id || '';
            }

            const task = {
                type: "conversation",
                action: action,
                question: userMessage,
                preferred_message_id: preferredMessageId,
                model: model,
                parent_message_id: parentMessageId,
                conversation_id: conversationId,
                raw_payload: payload,
            };

            if (task.raw_payload.action === 'variant' && !task.raw_payload.conversation_id) {
                res.writeHead(400, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({error: "Invalid request, please start a new conversation and try again"}));
            }

            const result = assignTaskToWorker(task, res, req.cookies?.auth_token);
            if (result.error) {
                if (!res.headersSent) {
                    res.writeHead(result.status || 500, {'Content-Type': 'application/json'});
                    return res.end(JSON.stringify({error: result.error}));
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

module.exports = startReverseProxy;