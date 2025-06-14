const fs = require('fs');
const path = require('path');
const url = require('url');
const cors = require('cors');
const express = require('express');
const cheerio = require('cheerio');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const {v4: uuidv4} = require('uuid');

const React = require('react');
const {renderToString} = require('react-dom/server');
const Avatar = require('boring-avatars').default;
const anonymizationService = require('./anonymization');

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
    addConversationAccess,
    getInternalAuthenticationToken,
    addGizmoAccess,
    listUserGizmos,
    verifyIntegrationApiKey,
    callWebhook
} = require('./auth');

const {mockSuccessDomains, mockSuccessPaths, bannedPaths, domainsToProxy} = require('../consts');
const {HttpsProxyAgent} = require("https-proxy-agent");
const {accounts, mapUserTokenToPendingNewConversation, incrementUsage, getAllAccounts} = require("../state/state");
const {processGizmoData, getGizmoById} = require('./gizmoMonitor');

const avatarCache = new Map();
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
                const delaySeconds = accounts.length === 1 ? 0 : Math.floor(Math.random() * 60);
                const delayMs = delaySeconds * 1000;
                results.push({
                    account: account.name,
                    scheduledDelay: `${delaySeconds} seconds`
                });

                setTimeout(async () => {
                    try {
                        await performDegradationCheckForAccount(account);
                        console.log(`degradation check completed for ${account.name}`);
                    } catch (error) {
                        console.error(`degradation check failed for ${account.name}:`, error);
                    }
                }, delayMs);
            }

            res.status(200).json({
                success: true,
                message: targetAccountName
                    ? `Scheduled degradation check for account: ${targetAccountName}`
                    : `Scheduled degradation checks for ${accounts.length} accounts`,
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
                res.cookie('account_id', req.query.account_id, {
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    httpOnly: false,
                    sameSite: 'lax',
                    path: '/'
                });
                res.cookie('account_email', req.query.account_email, {
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    httpOnly: false,
                    sameSite: 'lax',
                    path: '/'
                });
                res.cookie('account_switcher_url', req.query.account_switcher_url, {
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
            res.cookie('access_token', token, {
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


    app.get('/switch-account/:id', async (req, res) => {
        const accountId = req.params.id;

        const accounts = await anonymizationService.getAllAccountsWithAnonymizedData();
        let acc = accounts.find(account => account.id === accountId);
        if (!acc) {
            res.status(400).send(`Account ${accountId} not found`);
            return;
        }

        res.cookie('account_id', accountId, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: false,
            sameSite: 'lax',
            path: '/'
        });

        res.cookie('account_email', acc.email, {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: false,
            sameSite: 'lax',
            path: '/'
        });

        res.send(`Switched to account: ${accountId}`);
    });

    // Avatar rendering endpoint
    app.get('/avatar/:size/:seed', (req, res) => {
        const VARIANTS = ['marble', 'beam', 'pixel', 'sunset', 'ring', 'bauhaus'];

        function hashString(str) {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = (hash << 5) - hash + str.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash);
        }

        function pickVariant(seed) {
            const index = hashString(seed) % VARIANTS.length;
            return VARIANTS[index];
        }

        const {size, seed} = req.params;
        const parsedSize = parseInt(size, 10);
        const validatedSize =
            isNaN(parsedSize) || parsedSize < 1 || parsedSize > 500 ? 120 : parsedSize;

        // Stable variant selection
        const variant = pickVariant(seed);

        // Build a stable cache key (size|seed|variant)
        const cacheKey = `${validatedSize}|${seed}|${variant}`;

        // ===== 1. CACHE HIT  =====
        const cachedSVG = avatarCache.get(cacheKey);
        if (cachedSVG) {
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(cachedSVG);
        }

        // ===== 2. CACHE MISS =====
        try {
            const svgContent = renderToString(
                React.createElement(Avatar, {
                    size: validatedSize,
                    name: seed,
                    variant,
                }),
            );

            avatarCache.set(cacheKey, svgContent); // cache for lifetime of process

            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(svgContent);
        } catch (err) {
            console.error('Error generating avatar:', err);
            return res.status(500).send('Error generating avatar');
        }
    });


    app.get('/accounts', async (req, res) => {
        try {
            res.send(await anonymizationService.getAllAccountsWithAnonymizedData());
        } catch (error) {
            console.error('Error retrieving anonymized accounts:', error);
            res.status(500).json({error: 'Failed to retrieve accounts'});
        }
    });

    app.get('/usage', async (req, res) => {
        try {
            // Check authorization using bearer token
            const authHeader = req.headers.authorization;

            // Verify the authorization header format and token
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).json({error: 'Unauthorized: Missing or invalid authorization header'});
                return;
            }

            // Extract the token
            const token = authHeader.split(' ')[1];

            // Verify against the configured monitoring token
            if (token !== config.centralServer.auth.monitoringToken) {
                res.status(403).json({error: 'Forbidden: Invalid monitoring token'});
                return;
            }

            const accountLoadService = require('./accountLoad');

            // Get usage data in different views
            const usageByModel = await accountLoadService.getAggregatedUsageByModel();
            const usageByAccount = await accountLoadService.getUsageByAccount();

            // Return usage data in multiple views
            res.send({
                byModel: usageByModel,
                byAccount: usageByAccount
            });
        } catch (error) {
            console.error('Error retrieving usage data:', error);
            res.status(500).json({error: 'Failed to retrieve usage data'});
        }
    });

    /**
     * Handle all other routes (the "fallback") exactly as in original code
     */
    app.all('*', async (req, res) => {
        const accountId = req.cookies['account_id'];
        const selectedAccount = await anonymizationService.getSelectedAccountById(accountId);
        if (!selectedAccount) {
            if (req.cookies['account_switcher_url']) {
                return res.redirect(req.cookies['account_switcher_url']);
            }
            return res.redirect('/accountswitcher');
        }
        delete req.cookies['account_id'];
        delete req.cookies['account_name'];
        delete req.cookies['account_email'];

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

            const {targetHost, targetPath} = determineTarget(req.url);

            // We must gather request body as a buffer
            const requestChunks = [];
            for await (const chunk of req) {
                requestChunks.push(chunk);
            }
            const requestBodyBuffer = Buffer.concat(requestChunks);

            // 6) conversation streaming
            //    (both /backend-api/conversation and /backend-alt/conversation)
            if (
                req.method === 'POST' &&
                (parsedUrl.pathname === '/backend-api/conversation' ||
                    parsedUrl.pathname === '/backend-alt/conversation')
            ) {
                const conversationId = JSON.parse(requestBodyBuffer).conversation_id;
                if (conversationId) {

                    const {PrismaClient} = require('@prisma/client');
                    const prisma = new PrismaClient();
                    const userAccessToken = req.cookies?.access_token;

                    // Check if we have this conversation in our database for this user
                    const conversation = await prisma.conversation.findFirst({
                        where: {
                            id: conversationId,
                            userAccessToken: userAccessToken
                        }
                    });

                    if (conversation) {
                        // If the conversation is found, check if the account is the same as the current selected account
                        const isCurrentAccount = conversation.accountName === await getRealAccountName(selectedAccount);
                        const belongsTo = await anonymizationService.getOrCreateAnonymizedAccount(conversation.accountName);

                        if (isCurrentAccount) {
                            return await handleConversation(req, res, JSON.parse(requestBodyBuffer), {
                                doWork,
                                selectedAccount
                            });
                        } else {
                            res.writeHead(400, {'Content-Type': 'application/json'});
                            return res.end(
                                JSON.stringify({
                                    error: `this conversation belongs to account ${belongsTo.fakeEmail}, current account is ${selectedAccount.email}`,
                                })
                            );
                        }
                    } else {
                        return await handleConversation(req, res, JSON.parse(requestBodyBuffer), {
                            doWork,
                            selectedAccount
                        });
                    }
                } else {
                    // Check if this is a gizmo interaction
                    const requestData = JSON.parse(requestBodyBuffer);

                    if (requestData.conversation_mode?.kind === 'gizmo_interaction' && requestData.conversation_mode?.gizmo_id) {
                        const gizmoId = requestData.conversation_mode.gizmo_id;

                        // Check if the gizmo belongs to this account
                        const {PrismaClient} = require('@prisma/client');
                        const prisma = new PrismaClient();

                        try {
                            const gizmo = await prisma.gizmo.findUnique({
                                where: {id: gizmoId}
                            });

                            if (gizmo) {
                                const isCurrentAccount = gizmo.accountName === await getRealAccountName(selectedAccount);

                                if (!isCurrentAccount) {
                                    // Gizmo belongs to a different account
                                    const belongsTo = await anonymizationService.getOrCreateAnonymizedAccount(gizmo.accountName);

                                    await prisma.$disconnect();
                                    res.writeHead(400, {'Content-Type': 'application/json'});
                                    return res.end(
                                        JSON.stringify({
                                            error: `This gizmo belongs to account ${belongsTo.fakeEmail}, current account is ${selectedAccount.email}`
                                        })
                                    );
                                }
                            }

                            await prisma.$disconnect();
                        } catch (error) {
                            logger.error(`Error checking gizmo ownership: ${error.message}`);
                            await prisma.$disconnect();
                            // Continue despite error
                        }
                    }

                    return await handleConversation(req, res, requestData, {
                        doWork,
                        selectedAccount
                    });
                }
            }


            if (shouldMockSuccess(targetHost, targetPath)) {
                // Return the mock success JSON
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'access-control-allow-credentials': 'true',
                    'access-control-allow-origin': config.centralServer.url
                });
                return res.end(JSON.stringify({success: true}));
            }

            if (targetPath.startsWith('/backend-api/conversation/') &&
                !targetPath.split('?')[0].endsWith('generate_autocompletions') &&
                !targetPath.split('?')[0].endsWith('download') &&
                !targetPath.split('?')[0].endsWith('init') &&
                !targetPath.split('?')[0].endsWith('search')
            ) {
                const conversationId = targetPath.split('conversation/')[1].split('/')[0].split('?')[0];

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
                        targetPath.endsWith('/textdocs') ||
                        (await checkConversationAccess(conversationId, userIdentity));

                    if (!hasAccess) {
                        res.writeHead(401, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({error: 'not authorized'}));
                    }
                }

                if (req.method === "GET") {
                    const {PrismaClient} = require('@prisma/client');
                    const prisma = new PrismaClient();
                    const userAccessToken = req.cookies?.access_token;

                    // Check if we have this conversation in our database for this user
                    const conversation = await prisma.conversation.findFirst({
                        where: {
                            id: conversationId,
                            userAccessToken: userAccessToken
                        }
                    });

                    if (conversation) {
                        // If the conversation is found, check if the account is the same as the current selected account
                        const isCurrentAccount = conversation.accountName === await getRealAccountName(selectedAccount);

                        // If not from the current account
                        if (!isCurrentAccount) {
                            console.log(`Retrieving conversation ${conversationId} from database cache. Current account: ${isCurrentAccount ? 'yes' : 'no'}`);

                            if (conversation.conversationData) {
                                await prisma.$disconnect();

                                res.writeHead(200, {
                                    'Content-Type': 'application/json',
                                    'access-control-allow-origin': config.centralServer.url
                                });

                                // Return the conversation data from the database
                                return res.end(JSON.stringify(conversation.conversationData));
                            }
                        } else {
                            console.log(`Live retrieving conversation ${conversationId} from account ${selectedAccount.name}`);
                            // If it's the current account and we don't have sufficient data, let it live retrieve
                        }
                    }

                    await prisma.$disconnect();
                    // Continue with normal flow to proxy to ChatGPT
                }

            }

            // Handle gizmo conversations endpoint
            if (targetPath.split('?')[0].match(/\/backend-api\/gizmos\/[^\/]+\/conversations$/)) {
                const {PrismaClient} = require('@prisma/client');
                const prisma = new PrismaClient();
                const userAccessToken = req.cookies?.access_token;

                try {
                    // Extract gizmo ID from the path
                    const gizmoId = targetPath.split('/gizmos/')[1].split('/conversations')[0];

                    // Check if the user has access to this gizmo
                    const hasAccess = await prisma.gizmoAccess.findFirst({
                        where: {
                            gizmoId: gizmoId,
                            token: userAccessToken
                        }
                    });

                    if (!hasAccess) {
                        res.writeHead(403, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({
                            error: 'You do not have access to this gizmo'
                        }));
                    }

                    // Find all conversations for this gizmo
                    const conversations = await prisma.conversation.findMany({
                        where: {
                            gizmoId: gizmoId,
                            userAccessToken: userAccessToken
                        },
                        orderBy: {
                            updatedAt: 'desc'
                        }
                    });

                    // Format conversations for the response
                    const items = conversations.map(conv => {
                        // Extract title from conversation data
                        let title = "New chat";
                        if (conv.conversationData && typeof conv.conversationData === 'object') {
                            if (conv.conversationData.title ||
                                (conv.conversationData.data && conv.conversationData.data.title)) {
                                title = conv.conversationData.title || conv.conversationData.data.title;
                            }
                        }

                        return {
                            id: conv.id,
                            title: title,
                            create_time: conv.createdAt.toISOString(),
                            update_time: conv.updatedAt.toISOString(),
                            mapping: null,
                            current_node: null,
                            conversation_template_id: gizmoId,
                            gizmo_id: gizmoId,
                            is_archived: false,
                            is_starred: null,
                            is_do_not_remember: null,
                            memory_scope: "project_enabled",
                            workspace_id: null,
                            async_status: null,
                            safe_urls: [],
                            blocked_urls: [],
                            conversation_origin: null,
                            snippet: null
                        };
                    });

                    const response = {items};

                    await prisma.$disconnect();

                    // Return our custom response
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'access-control-allow-origin': config.centralServer.url
                    });
                    return res.end(JSON.stringify(response));
                } catch (error) {
                    logger.error(`Error handling gizmo conversations: ${error.message}`);
                    await prisma.$disconnect();
                    // Continue with normal proxy flow on error
                }
            }

            // Handle gizmo data caching and updates
            if (targetPath.startsWith('/backend-api/gizmos/')) {
                let gizmoId = null;

                // For regular gizmo endpoints
                if (!targetPath.includes('/conversation/') &&
                    !targetPath.includes('/bootstrap') &&
                    !targetPath.includes('/sidebar') &&
                    !targetPath.includes('/conversations')) {

                    gizmoId = targetPath.split('/gizmos/')[1].split('/')[0].split('?')[0];
                }
                // For snorlax upsert endpoint
                else if (targetPath.endsWith('/backend-api/gizmos/snorlax/upsert') && req.method === "POST") {
                    try {
                        // Parse the request body to get the gizmo ID for upsert operations
                        const requestData = JSON.parse(requestBodyBuffer.toString());
                        gizmoId = requestData?.resource?.gizmo?.id || null;
                    } catch (error) {
                        logger.error(`Error parsing upsert request body: ${error.message}`);
                    }
                }

                if (gizmoId) {
                    const userAccessToken = req.cookies?.access_token;

                    if (!userAccessToken) {
                        res.writeHead(401, {'Content-Type': 'application/json'});
                        return res.end(JSON.stringify({error: 'User identity not provided'}));
                    }

                    try {
                        // Get the gizmo from our database
                        const gizmo = await getGizmoById(gizmoId);

                        if (gizmo) {
                            // Check if the gizmo is from the current account
                            const isCurrentAccount = gizmo.accountName === await getRealAccountName(selectedAccount);

                            // For POST requests (updates), reject if not from the current account
                            if (req.method === "POST" && !isCurrentAccount) {
                                const belongsTo = await anonymizationService.getOrCreateAnonymizedAccount(gizmo.accountName);

                                res.writeHead(400, {'Content-Type': 'application/json'});
                                return res.end(
                                    JSON.stringify({
                                        error: `This gizmo belongs to account ${belongsTo.fakeEmail}, current account is ${selectedAccount.email}`
                                    })
                                );
                            }
                            // For GET requests, serve from cache if not from current account
                            else if (req.method === "GET" && !isCurrentAccount) {
                                console.log(`Retrieving gizmo ${gizmoId} from database cache. Current account: ${isCurrentAccount ? 'yes' : 'no'}`);

                                if (gizmo.gizmoData) {
                                    res.writeHead(200, {
                                        'Content-Type': 'application/json',
                                        'access-control-allow-origin': config.centralServer.url
                                    });

                                    // Return the gizmo data from the database
                                    return res.end(JSON.stringify(gizmo.gizmoData));
                                }
                            } else {
                                console.log(`Live retrieving/updating gizmo ${gizmoId} from account ${selectedAccount.name}`);
                                // If it's the current account, let it live retrieve/update
                            }
                        } else if (req.method === "GET") {
                            console.log(`No cached data found for gizmo ${gizmoId}, proceeding with live retrieval`);
                        }
                    } catch (error) {
                        logger.error(`Error while checking gizmo cache: ${error.message}`);
                        // Continue with normal proxy flow on error
                    }
                }
            }

            // Handle search endpoint specifically
            if (targetPath.split('?')[0] === '/backend-api/conversations/search') {
                // Handle dedicated search endpoint
                if (req.method === 'GET') {
                    const {PrismaClient} = require('@prisma/client');
                    const prisma = new PrismaClient();
                    const userAccessToken = req.cookies?.access_token;

                    try {
                        // Parse query parameters
                        const parsedUrl = url.parse(req.url, true);
                        const searchQuery = parsedUrl.query.query || '';

                        // Search results limited to 10 as requested
                        const limit = 10;

                        // Build search conditions
                        let whereClause = {
                            userAccessToken: userAccessToken
                        };

                        // Add search condition
                        if (searchQuery) {
                            // Simplify the search approach to avoid JSON path errors
                            // Just check if the entire JSON string contains the search query
                            const searchPattern = `%${searchQuery}%`;

                            // Use raw SQL condition
                            whereClause = {
                                userAccessToken: userAccessToken,
                            };
                        }

                        // Get search results
                        const conversations = await prisma.conversation.findMany({
                            where: whereClause,
                            orderBy: {
                                updatedAt: 'desc'
                            },
                            take: limit
                        });

                        // Manually filter the results to match search query
                        // since we couldn't use the JSON path in where clause
                        const filteredConversations = searchQuery
                            ? conversations.filter(conv => {
                                if (!conv.conversationData) return false;

                                // Check for the title first if it exists
                                if (conv.conversationData.data &&
                                    conv.conversationData.data.title &&
                                    conv.conversationData.data.title.toLowerCase().includes(searchQuery.toLowerCase())) {
                                    return true;
                                }

                                // Fall back to checking the entire JSON string
                                return JSON.stringify(conv.conversationData).toLowerCase().includes(searchQuery.toLowerCase());
                            })
                            : conversations;

                        // The total count needs to match our filtered results
                        const total = filteredConversations.length;

                        // Format results specifically for search endpoint
                        const items = filteredConversations.map(conv => {
                            // Extract title
                            let title = "New chat";
                            if (conv.conversationData && typeof conv.conversationData === 'object') {
                                if (conv.conversationData.data && conv.conversationData.data.title) {
                                    title = conv.conversationData.data.title;
                                }
                            }

                            return {
                                conversation_id: conv.id,
                                current_node_id: '', // TODO, improve search
                                title: title,
                                payload: {
                                    kind: "message",
                                    message_id: '', // TODO, improve search
                                    snippet: ''
                                },
                                create_time: +conv.createdAt / 1000,
                                update_time: +conv.updatedAt / 1000,
                            };
                        });

                        const response = {
                            items: items,
                            total: total,
                            limit: limit,
                            offset: 0
                        };

                        await prisma.$disconnect();

                        // Send search results
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'access-control-allow-origin': config.centralServer.url
                        });
                        return res.end(JSON.stringify(response));
                    } catch (error) {
                        console.error('Error executing search:', error);
                        await prisma.$disconnect();

                        // Return empty results on error
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'access-control-allow-origin': config.centralServer.url
                        });
                        return res.end(JSON.stringify({
                            items: [],
                            total: 0,
                            limit: 10,
                            offset: 0
                        }));
                    }
                }
                return; // Don't continue to the regular conversations handler
            }

            // Get conversations from database (regular list)
            if (targetPath.split('?')[0] === '/backend-api/conversations') {
                // Use the saved conversations from our database instead of proxying to ChatGPT
                if (req.method === 'GET') {
                    const {PrismaClient} = require('@prisma/client');
                    const prisma = new PrismaClient();
                    const userAccessToken = req.cookies?.access_token;

                    // Parse query parameters
                    const parsedUrl = url.parse(req.url, true);
                    const offset = parseInt(parsedUrl.query.offset) || 0;
                    const limit = parseInt(parsedUrl.query.limit) || 28;
                    const order = parsedUrl.query.order || 'updated';

                    // Regular listing conditions - filter out gizmo conversations
                    const whereClause = {
                        userAccessToken: userAccessToken,
                        gizmoId: null // Only include conversations with no gizmo ID
                    };

                    // Query conversations from our database
                    const conversations = await prisma.conversation.findMany({
                        where: whereClause,
                        orderBy: {
                            updatedAt: order.includes('updated') ? 'desc' : 'asc'
                        },
                        skip: offset,
                        take: limit
                    });

                    // Get total count with same search conditions
                    let total = await prisma.conversation.count({
                        where: whereClause
                    });

                    const startTime = +new Date();
                    if (mapUserTokenToPendingNewConversation[userAccessToken] && (+new Date() - mapUserTokenToPendingNewConversation[userAccessToken].startTime > 60000)) {
                        delete mapUserTokenToPendingNewConversation[userAccessToken];
                    }
                    while (true) {
                        if (mapUserTokenToPendingNewConversation[userAccessToken] && !mapUserTokenToPendingNewConversation[userAccessToken].conversationId && +new Date() - startTime < 10000) {
                            await sleep(100);
                        } else {
                            break;
                        }
                    }


                    // Format response to match the expected structure
                    const items = conversations.map(conv => {
                        // Extract title from conversation data if available
                        let title = "New chat";
                        if (conv.conversationData && typeof conv.conversationData === 'object') {
                            if (conv.conversationData && conv.conversationData.title) {
                                title = conv.conversationData.title;
                            }
                        }

                        return {
                            id: conv.id,
                            title: title,
                            create_time: conv.createdAt.toISOString(),
                            update_time: conv.updatedAt.toISOString(),
                            mapping: null,
                            current_node: null,
                            conversation_template_id: null,
                            gizmo_id: null,
                            is_archived: false,
                            is_starred: null,
                            is_do_not_remember: null,
                            workspace_id: null,
                            async_status: null,
                            safe_urls: [],
                            blocked_urls: [],
                            conversation_origin: null,
                            snippet: null
                        };
                    });


                    if (offset === 0) {
                        const conversationIdToEnsure = mapUserTokenToPendingNewConversation[userAccessToken] ? mapUserTokenToPendingNewConversation[userAccessToken].conversationId : null;

                        if (conversationIdToEnsure && !conversations.some(c => c.id === conversationIdToEnsure)) {
                            items.unshift({
                                id: conversationIdToEnsure,
                                title: "New chat",
                                create_time: (new Date()).toISOString(),
                                update_time: (new Date()).toISOString(),
                            });
                            if (items.length > limit) {
                                items.pop();
                            }
                            total += 1;
                        }
                    }

                    const response = {
                        items: items,
                        total: total,
                        limit: limit,
                        offset: offset
                    };

                    await prisma.$disconnect();

                    // Send response
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'access-control-allow-origin': config.centralServer.url
                    });
                    return res.end(JSON.stringify(response));

                }
            }

            // Finally, pass everything else to standard proxy
            await proxyRequest(req, res, targetHost, targetPath, requestBodyBuffer, selectedAccount);
        } catch (err) {
            logger.error(err);
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
    } else if (requestUrl.includes('sandbox') && !requestUrl.includes('interpreter/download')) {
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

const getHttpsProxyAgentCache = {};

async function getHttpsProxyAgent(account) {
    const realAccountName = await anonymizationService.getRealAccountNameById(account.id);
    const {accounts} = require("../state/state.js");
    const proxy = accounts[realAccountName].proxy;
    if (!getHttpsProxyAgentCache[proxy]) {
        getHttpsProxyAgentCache[proxy] = new HttpsProxyAgent(proxy);
    }
    return getHttpsProxyAgentCache[proxy];
}

async function getCookie(account) {
    const realAccountName = await anonymizationService.getRealAccountNameById(account.id);
    const {accounts} = require("../state/state.js");
    return accounts[realAccountName].cookie;
}


async function getAccessToken(account) {
    const realAccountName = await anonymizationService.getRealAccountNameById(account.id);
    const {accounts} = require("../state/state.js");
    return accounts[realAccountName].accessToken;
}

async function getRealAccountName(account) {
    return await anonymizationService.getRealAccountNameById(account.id);
}

/**
 * The main proxy handler
 */
async function proxyRequest(req, res, targetHost, targetPath, requestBodyBuffer, selectedAccount) {
    // Import the deep research monitor helper if not already available
    const {processConversationForDeepResearch} = require('./deepResearchMonitor');
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
        if (headers['referrer']) {
            delete headers['referrer'];
        }

        let selectedAccountCookie = await getCookie(selectedAccount);
        let selectedAccountAccessToken = await getAccessToken(selectedAccount);
        let realAccountName = await getRealAccountName(selectedAccount);

        if (req.method === 'PATCH' &&
            targetPath.startsWith('/backend-api/conversation/') &&
            requestBodyBuffer &&
            requestBodyBuffer.toString().includes('"is_visible":false')) {

            // Parse the request body
            const bodyContent = requestBodyBuffer.toString();
            const parsedBody = JSON.parse(bodyContent);

            if (parsedBody.is_visible === false) {
                const conversationId = targetPath.split('/conversation/')[1].split('/')[0];

                // Find the conversation to determine its account
                const {PrismaClient} = require('@prisma/client');
                const prisma = new PrismaClient();
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: conversationId
                    }
                });

                // If we found the conversation and it belongs to a different account
                if (conversation && conversation.accountName !== realAccountName) {
                    // Get the correct account for this conversation
                    const conversationAccount = getAllAccounts().find(acc => acc.name === conversation.accountName);

                    if (conversationAccount) {
                        // Use the correct account's cookie and token
                        headers['authorization'] = `Bearer ${conversationAccount.accessToken}`;
                        headers['cookie'] = `__Secure-next-auth.session-token=${conversationAccount.cookie}`;
                        console.log(`Using account ${conversationAccount.name} for deletion of conversation ${conversationId}`);
                        await prisma.$disconnect();
                    } else {
                        await prisma.$disconnect();
                        headers['cookie'] = `__Secure-next-auth.session-token=${selectedAccountCookie}`;
                        headers['authorization'] = `Bearer ${selectedAccountAccessToken}`;
                    }
                } else {
                    await prisma.$disconnect();
                    headers['cookie'] = `__Secure-next-auth.session-token=${selectedAccountCookie}`;
                    headers['authorization'] = `Bearer ${selectedAccountAccessToken}`;
                }
            } else {
                headers['cookie'] = `__Secure-next-auth.session-token=${selectedAccountCookie}`;
                headers['authorization'] = `Bearer ${selectedAccountAccessToken}`;
            }
        } else {
            headers['cookie'] = `__Secure-next-auth.session-token=${selectedAccountCookie}`;
            headers['authorization'] = `Bearer ${selectedAccountAccessToken}`;
        }

        // Determine if this is a streaming request
        const isStreamRequest = targetPath.includes('/stream');

        const axiosConfig = {
            method: req.method,
            url: `https://${targetHost}${targetPath}`,
            headers: headers,
            httpsAgent: await getHttpsProxyAgent(selectedAccount),
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

            // Check if this is a GET request for a conversation
            if (req.method === 'GET' &&
                targetPath.startsWith('/backend-api/conversation/') &&
                !targetPath.split('?')[0].endsWith('generate_autocompletions') &&
                !targetPath.split('?')[0].endsWith('download') &&
                !targetPath.split('?')[0].endsWith('init') &&
                !targetPath.split('?')[0].endsWith('search') &&
                !targetPath.split('?')[0].endsWith('textdocs') &&
                isTextResponse) {

                try {
                    // Get conversation ID from the path
                    const conversationId = targetPath.split('conversation/')[1].split('/')[0].split('?')[0];

                    // Parse the response data
                    const responseData = JSON.parse(buffer.toString());

                    // Process it for deep research status checks
                    // This will update both the conversation data and any deep research tasks
                    await processConversationForDeepResearch(responseData, conversationId);

                    console.log(`Processed live conversation ${conversationId} for deep research status`);
                } catch (deepResearchError) {
                    logger.error(`Error processing deep research during live retrieval: ${deepResearchError.message}`);
                    // Continue with the normal flow, don't block the response
                }
            }

            // Process gizmo data from responses (both GET and POST)
            if (isTextResponse &&
                ((req.method === 'GET' &&
                        targetPath.startsWith('/backend-api/gizmos/') &&
                        !targetPath.includes('/conversation/') &&
                        !targetPath.includes('/conversations') &&
                        !targetPath.includes('/bootstrap') &&
                        !targetPath.includes('/sidebar')) ||
                    (req.method === 'POST' && targetPath.endsWith('/backend-api/gizmos/snorlax/upsert')))) {

                try {
                    let gizmoId = null;
                    // For GET requests, extract from path
                    if (req.method === 'GET') {
                        gizmoId = targetPath.split('/gizmos/')[1].split('/')[0].split('?')[0];
                    }
                    // For POST requests, extract from response
                    else if (req.method === 'POST') {
                        const responseData = JSON.parse(buffer.toString());
                        gizmoId = responseData?.resource?.gizmo?.id || null;
                    }

                    if (gizmoId) {
                        // Parse the response data
                        const responseData = JSON.parse(buffer.toString());

                        // Get the user token and account name
                        const userAccessToken = req.cookies?.access_token;
                        const realAccountName = await getRealAccountName(selectedAccount);

                        // Process the gizmo data
                        await processGizmoData(responseData, gizmoId, userAccessToken, realAccountName);

                        console.log(`Processed gizmo data for ${gizmoId} from ${req.method} request`);
                    }
                } catch (gizmoError) {
                    logger.error(`Error processing gizmo data during ${req.method}: ${gizmoError.message}`);
                    // Continue with the normal flow, don't block the response
                }
            }

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
                modifiedContent = modifiedContent.replace(selectedAccountAccessToken, '');
                modifiedContent = modifiedContent.replace(selectedAccountCookie, '');

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
                if (req.method === 'GET' && req.url.indexOf("/backend-api/") < 0 && req.url.indexOf("/public-api/") < 0 && !req.url.endsWith(".js") && !req.url.endsWith(".css")) {
                    modifiedContent = changeReactRouterStreamControllerEnqueue(modifiedContent);
                }
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
                modifiedContent = modifiedContent.replace(
                    new RegExp('\\\\"planType\\\\",\\\\".+?\\\\"'),
                    `\\"planType\\",\\"` + selectedAccount.labels.plan + `\\"`
                );

                if (
                    req.method === 'GET' && req.url.indexOf("/backend-api/") < 0 && req.url.indexOf("/public-api/") < 0 && !req.url.endsWith(".js") && !req.url.endsWith(".css")
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
                    req.method === 'PATCH' &&
                    targetPath.startsWith('/backend-api/conversation/') &&
                    !targetPath.split('?')[0].endsWith('generate_autocompletions') &&
                    !targetPath.split('?')[0].endsWith('download') &&
                    !targetPath.split('?')[0].endsWith('init') &&
                    !targetPath.split('?')[0].endsWith('search')
                ) {
                    const conversationId = targetPath.split('/conversation/')[1].split('/')[0];
                    let parsed = JSON.parse(requestBodyBuffer.toString());
                    if (parsed.title) {
                        const {PrismaClient} = require('@prisma/client');
                        const prisma = new PrismaClient();
                        const conversation = await prisma.conversation.findFirst({
                            where: {
                                id: conversationId,
                            }
                        });

                        conversation.conversationData.title = parsed.title;

                        await prisma.conversation.update({
                            where: {
                                id: conversationId,
                            },
                            data: {
                                conversationData: conversation.conversationData,
                                gizmoId: conversation.conversationData?.data?.gizmo_id,
                            }
                        });
                    }
                    if (parsed.is_visible === false) {
                        const {PrismaClient} = require('@prisma/client');
                        const prisma = new PrismaClient();
                        await prisma.conversation.delete({
                            where: {
                                id: conversationId,
                            }
                        });
                    }
                }

                if (targetPath.startsWith('/backend-api/gizmos/snorlax/sidebar')) {
                    // Use our database to build the sidebar content instead of relying on proxy data
                    const {PrismaClient} = require('@prisma/client');
                    const prisma = new PrismaClient();
                    const userAccessToken = req.cookies?.access_token;

                    try {
                        // Get user's gizmos from GizmoAccess table
                        const userGizmos = await listUserGizmos(userAccessToken);
                        const gizmoIds = userGizmos.map(ug => ug.gizmoId);

                        // Get detailed gizmo data from our database
                        const gizmos = await prisma.gizmo.findMany({
                            where: {
                                id: {
                                    in: gizmoIds
                                }
                            }
                        });

                        // For each gizmo, find related conversations
                        const sidebarItems = [];

                        for (const gizmo of gizmos) {
                            // Find conversations that use this gizmo
                            const conversations = await prisma.conversation.findMany({
                                where: {
                                    gizmoId: gizmo.id,
                                    userAccessToken: userAccessToken
                                },
                                orderBy: {
                                    updatedAt: 'desc'
                                }
                            });

                            // Format conversations for the response
                            const conversationItems = conversations.map(conv => {
                                // Extract title from conversation data
                                let title = "New chat";
                                if (conv.conversationData && typeof conv.conversationData === 'object') {
                                    if (conv.conversationData.title ||
                                        (conv.conversationData.data && conv.conversationData.data.title)) {
                                        title = conv.conversationData.title || conv.conversationData.data.title;
                                    }
                                }

                                return {
                                    id: conv.id,
                                    title: title,
                                    create_time: conv.createdAt.toISOString(),
                                    update_time: conv.updatedAt.toISOString(),
                                    mapping: null,
                                    current_node: null,
                                    conversation_template_id: gizmo.id,
                                    gizmo_id: gizmo.id,
                                    is_archived: false,
                                    is_starred: null,
                                    is_do_not_remember: null,
                                    memory_scope: "project_enabled",
                                    workspace_id: null,
                                    async_status: null,
                                    safe_urls: [],
                                    blocked_urls: [],
                                    conversation_origin: null,
                                    snippet: null
                                };
                            });

                            // Add the gizmo with its conversations to the sidebar
                            sidebarItems.push({
                                gizmo: gizmo.gizmoData,
                                conversations: {
                                    items: conversationItems
                                }
                            });
                        }

                        // Create the final response format
                        const response = {
                            items: sidebarItems,
                            cursor: null
                        };

                        await prisma.$disconnect();

                        // Return our custom response instead of the modified proxy response
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'access-control-allow-origin': config.centralServer.url
                        });
                        return res.end(JSON.stringify(response));
                    } catch (error) {
                        logger.error(`Error building gizmo sidebar: ${error.message}`);
                        await prisma.$disconnect();

                        // Fall back to filtering the proxy response if our approach fails
                        let parsed = JSON.parse(modifiedContent);
                        const ids = {};
                        for (let uc of userGizmos) {
                            ids[uc.gizmoId] = true;
                        }
                        parsed.items = parsed.items.filter((item) => !!ids[item.gizmo.gizmo.id]);
                        modifiedContent = JSON.stringify(parsed);
                    }
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
async function handleConversation(req, res, payload, {doWork, selectedAccount}) {
    logger.info('Handling streaming conversation request');


    try {
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
                    error: 'Something went wrong, Please try reloading the conversation'
                })
            );
        }

        // Check if this is a request for an existing conversation and verify account match
        if (task.conversation_id) {
            try {
                const {PrismaClient} = require('@prisma/client');
                const prisma = new PrismaClient();

                // Find the conversation in our database
                const conversation = await prisma.conversation.findUnique({
                    where: {id: task.conversation_id}
                });

                // If conversation exists but doesn't match current account, reject the request
                if (conversation && conversation.userAccessToken !== req.cookies?.access_token) {
                    await prisma.$disconnect();
                    res.writeHead(403, {'Content-Type': 'application/json'});
                    return res.end(
                        JSON.stringify({
                            error: 'This conversation is not accessible from your current account'
                        })
                    );
                }

                await prisma.$disconnect();
            } catch (error) {
                console.error(`Error checking conversation account match: ${error.message}`);
                // Continue if there's an error, the regular authorization will still apply
            }
        }

        // Check with webhook for managed users
        const token = req.cookies?.access_token;
        if (token) {
            const webhookResult = await callWebhook(token, 'conversation_start',
                {
                    action: task.action,
                    model: model,
                    question: userMessage,
                    conversation_id: conversationId || null,
                },
                {"accept-language": (req.cookies?.['oai-locale'] || "en-US")}
            );

            if (!webhookResult.allowed) {
                res.writeHead(403, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify({
                    error: webhookResult.reason || "unspecified reason",
                }));
            }
        }

        logger.info('assigning conversation task to worker');
        incrementUsage(await getRealAccountName(selectedAccount), model);

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
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function changeReactRouterStreamControllerEnqueue(html) {
    return html.split('conversationHistory').replace('___conversationHistory');
    // Load the HTML into cheerio
    const $ = cheerio.load(html, {
        // Preserve the original HTML structure as much as possible
        decodeEntities: false,
        xmlMode: false
    });

    // Read input.txt and split into lines
    const inputLines = fs.readFileSync('react-router-stream-controller-enqueue.txt', 'utf8').trim().split('\n');

    // Replace script content in each hidden div S:0 through S:5
    for (let i = 0; i < 6; i++) {
        const divSelector = `div[hidden][id="S:${i}"]`;
        const $div = $(divSelector);

        if ($div.length > 0 && inputLines[i]) {
            // Find the script tag within this div
            const $script = $div.find('script');
            if ($script.length > 0) {
                // Replace the script content with the corresponding line from input.txt
                $script.text(`\n                ${inputLines[i]}\n            `);
            }
        }
    }

    // Return the modified HTML
    return $.html();
}

module.exports = {startReverseProxy};
