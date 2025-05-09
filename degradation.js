const path = require("path");
const config = require(path.join(__dirname, process.env.CONFIG));
const {getInternalAuthenticationToken} = require("./services/auth");
const axios = require("axios");
const {v4: uuidv4} = require("uuid");
const {getAllAccounts, calculateAccountLoad, usageCounters} = require("./state/state");
const {PrismaClient} = require("@prisma/client");
const prisma = new PrismaClient();


// Initialize the system with database persistence
console.log("Initializing degradation check system with database persistence");

// Declaration of performDatabaseMaintenance comes later in the file,
// using the hoisted function declaration

setInterval(async () => {
    const accounts = getAllAccounts();

    for (const account of accounts) {
        // Get the most recent check from the database
        const latestCheck = await prisma.degradationCheckResult.findFirst({
            where: {
                accountName: account.name
            },
            orderBy: {
                checkTime: 'desc'
            }
        });

        // If no check exists yet, perform the check
        if (!latestCheck) {
            // Introduce a jitter (1 to 5 minutes)
            const jitter = Math.floor(Math.random() * 5 + 1) * 60 * 1000; // 1 to 5 minutes in ms
            setTimeout(() => {
                console.log(`Performing degradation check for ${account.name} (No previous check found)`);
                performDegradationCheckForAccount(account);
            }, jitter);
            continue;
        }

        const lastCheckTime = latestCheck.checkTime.getTime();
        const now = Date.now();

        // Check if last check time is less than 3 hours ago
        if (now - lastCheckTime < 3 * 60 * 60 * 1000) {
            // No need to perform a check if it's less than 3 hours ago
            continue;
        }

        // If it's greater than 5 hours ago, perform a degradation check
        if (now - lastCheckTime > 5 * 60 * 60 * 1000) {
            // Introduce a jitter (1 to 5 minutes)
            const jitter = Math.floor(Math.random() * 5 + 1) * 60 * 1000; // 1 to 5 minutes in ms

            setTimeout(() => {
                console.log(`Performing degradation check for ${account.name} (Last check was more than 5 hours ago)`);
                performDegradationCheckForAccount(account);
            }, jitter);

            continue;
        }

        // If it's between 3 and 5 hours ago, we perform the check with 10% chance
        if (now - lastCheckTime >= 3 * 60 * 60 * 1000 && Math.random() < 0.1) {
            // Introduce a jitter (1 to 5 minutes)
            const jitter = Math.floor(Math.random() * 5 + 1) * 60 * 1000; // 1 to 5 minutes in ms

            setTimeout(() => {
                console.log(`Performing degradation check for ${account.name} (Last check was between 3 and 5 hours ago, 10% chance)`);
                performDegradationCheckForAccount(account);
            }, jitter);
        }
    }
}, 600000);

/**
 * Perform the degradation check for a single account with retry logic
 */
async function performDegradationCheckForAccount(account) {
    try {
        console.log(`Performing degradation check for ${account.name}`);

        // Get degradation check result
        const degradationResult = await checkDegradation(account);
        const checkTime = new Date();

        // Save the result to the database
        await prisma.degradationCheckResult.create({
            data: {
                accountName: account.name,
                knowledgeCutoffDateString: degradationResult.knowledgeCutoffDateString,
                knowledgeCutoffTimestamp: degradationResult.knowledgeCutoffTimestamp,
                degradation: degradationResult.degradation,
                checkTime: checkTime
            }
        });

        console.log(`Degradation check successful for ${account.name} and saved to database`);
    } catch (error) {
        console.error(`Degradation check failed for ${account.name}:`, error);
    }
}

/**
 * Handle the HTTP request for metrics
 */
async function handleMetrics(req, res, options = {}) {
    // Check authorization using bearer token
    const authHeader = req.headers.authorization;

    // Verify the authorization header format and token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).send('Unauthorized: Missing or invalid authorization header');
        return;
    }

    // Extract the token
    const token = authHeader.split(' ')[1];

    // Verify against the configured monitoring token
    if (token !== config.centralServer.auth.monitoringToken) {
        res.status(403).send('Forbidden: Invalid monitoring token');
        return;
    }

    const {getAllAccounts} = require('./state/state');
    const accountLoadService = require('./services/accountLoad');

    // Common metric definitions at the top
    let metricsOutput = `
# HELP chatgpt_knowledge_cutoff_date The knowledge cutoff date of the model in Unix timestamp
# TYPE chatgpt_knowledge_cutoff_date gauge
# HELP chatgpt_degradation The degradation level (0=not degraded, 1=slightly degraded, 2=severely degraded)
# TYPE chatgpt_degradation gauge
# HELP chatgpt_last_check_timestamp The timestamp of the last successful check
# TYPE chatgpt_last_check_timestamp gauge
# HELP chatgpt_load The current load of the account (0-100)
# TYPE chatgpt_load gauge
`.trimStart();

    try {
        // Get all accounts that have workers connected
        const availableAccounts = getAllAccounts();

        for (const account of availableAccounts) {
            // Get the most recent degradation check result from the database
            const latestResult = await prisma.degradationCheckResult.findFirst({
                where: {
                    accountName: account.name
                },
                orderBy: {
                    checkTime: 'desc'
                }
            });

            // If we have a valid result for this account, add it to the metrics output
            if (latestResult) {
                const labelObj = {account_name: account.name, ...account.labels};
                const labelString = Object.entries(labelObj)
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(',');

                // Get the load value from the account load service
                const load = await accountLoadService.calculateLoad(account.name);

                // Add each metric line with the appropriate labels
                metricsOutput += `
chatgpt_knowledge_cutoff_date{${labelString}} ${latestResult.knowledgeCutoffTimestamp}
chatgpt_degradation{${labelString}} ${latestResult.degradation}
chatgpt_last_check_timestamp{${labelString}} ${Math.floor(latestResult.checkTime.getTime() / 1000)}
chatgpt_load{${labelString}} ${load}
`;
            }
        }

        // Get usage data from accountLoadService
        const usageByModel = await accountLoadService.getAggregatedUsageByModel();

        metricsOutput += `
# HELP chatgpt_usage_total The total number of user conversation requests
# TYPE chatgpt_usage_total counter
`;

        // Add detailed usage metrics from the database
        for (const [model, data] of Object.entries(usageByModel)) {
            for (const [accountName, count] of Object.entries(data.accounts)) {
                metricsOutput += `chatgpt_usage_total{account_name="${accountName}",model="${model}"} ${count}\n`;
            }
        }

        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.status(200).send(metricsOutput);
    } catch (error) {
        console.error('Error retrieving metrics data:', error);
        res.status(500).send('Error retrieving metrics data');
    }
}

/**
 * Database maintenance function to purge degradation check records
 * - Removes all records for accounts that haven't been checked in the last 6 hours
 * - Also removes very old records (older than 30 days) to keep database size manageable
 */
async function performDatabaseMaintenance() {
    try {
        // Get all accounts with check results using Prisma's groupBy
        const accounts = await prisma.degradationCheckResult.groupBy({
            by: ['accountName'],
            _max: {
                checkTime: true
            }
        });

        const sixHoursAgo = new Date();
        sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);

        // Identify accounts whose latest check is older than 6 hours
        const inactiveAccounts = accounts
            .filter(account => account._max.checkTime < sixHoursAgo)
            .map(account => account.accountName);

        let totalDeleted = 0;

        // Delete records for inactive accounts
        if (inactiveAccounts.length > 0) {
            const result = await prisma.degradationCheckResult.deleteMany({
                where: {
                    accountName: {
                        in: inactiveAccounts
                    }
                }
            });

            totalDeleted += result.count;

            if (result.count > 0) {
                console.log(`Database maintenance: removed ${result.count} degradation check records for ${inactiveAccounts.length} inactive accounts (no checks in last 6 hours)`);
            }
        }

        // Also clean up very old records (30+ days) for active accounts
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const oldRecordsResult = await prisma.degradationCheckResult.deleteMany({
            where: {
                checkTime: {
                    lt: thirtyDaysAgo
                }
            }
        });

        totalDeleted += oldRecordsResult.count;

        if (oldRecordsResult.count > 0) {
            console.log(`Database maintenance: removed ${oldRecordsResult.count} degradation check records older than 30 days`);
        }

        if (totalDeleted > 0) {
            console.log(`Database maintenance: total records removed: ${totalDeleted}`);
        }
    } catch (error) {
        console.error("Error performing database maintenance:", error);
    }
}

// Run once at startup
performDatabaseMaintenance().catch(err => console.error("Failed to run initial database maintenance:", err));

// Schedule database maintenance to run every 10 minutes
// This aligns with the old logic of regularly checking for stale data
setInterval(performDatabaseMaintenance, 10 * 60 * 1000);

const anonymizationService = require('./services/anonymization');


/**
 * Core function that talks to /backend-api/conversation for a specific account
 * and returns the parsed results.
 */
async function checkDegradation(account) {
    // Insert your internal token retrieval logic here
    const token = getInternalAuthenticationToken();

    const acc = await anonymizationService.getOrCreateAnonymizedAccount(account.name);

    const response = await axios({
        method: 'POST',
        url: 'http://127.0.0.1:' + config.centralServer.port + '/backend-api/conversation',
        headers: {
            'accept': 'text/event-stream',
            'content-type': 'application/json',
            'x-internal-authentication': token,
            'cookie': 'account_id=' + acc.id,
        },
        data: {
            action: 'next',
            messages: [{
                id: uuidv4(),
                author: {role: 'user'},
                create_time: (+new Date()) / 1000,
                content: {
                    content_type: 'text',
                    parts: ['what is your knowledge cutoff date, only reply "yyyy-MM"']
                },
                metadata: {
                    selected_github_repos: [],
                    serialization_metadata: {custom_symbol_offsets: []},
                    dictation: false
                }
            }],
            parent_message_id: 'client-created-root',
            model: 'gpt-4o',
            timezone_offset_min: -480,
            timezone: 'Asia/Shanghai',
            conversation_mode: {kind: 'primary_assistant'},
            enable_message_followups: true,
            system_hints: [],
            supports_buffering: true,
            supported_encodings: ['v1'],
            client_contextual_info: {
                is_dark_mode: true,
                time_since_loaded: 3,
                page_height: 992,
                page_width: 952,
                pixel_ratio: 2,
                screen_height: 1117,
                screen_width: 1728
            },
            paragen_cot_summary_display_override: 'allow',
            path_to_message: [],
            delete_conversation_immediately_afterwards: true,
        },
        responseType: 'stream',
        timeout: 10000 // Overall request timeout
    });

    const result = await new Promise((resolve, reject) => {
        let fullContent = '';
        let buffer = '';
        let conversationId = '';

        // Set a timeout for stream processing
        const streamTimeout = setTimeout(() => {
            reject(new Error('Stream processing timeout'));
        }, 9000);

        response.data.on('data', (chunk) => {
            const chunkString = chunk.toString();
            buffer += chunkString;

            // Process complete events in the buffer
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in the buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6); // Remove 'data: ' prefix

                    if (data === '[DONE]') {
                        // Stream is complete
                        clearTimeout(streamTimeout);
                        resolve({content: fullContent, conversationId});
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        // Extract conversation_id if available
                        if (parsed.conversation_id) {
                            conversationId = parsed.conversation_id;
                        } else if (parsed.v && parsed.v.conversation_id) {
                            conversationId = parsed.v.conversation_id;
                        }

                        // Handle different message types
                        if (parsed.type === 'message_stream_complete') {
                            // Stream complete
                        } else if (parsed.v && parsed.v.message) {
                            // Initial message
                            if (parsed.v.message.content && parsed.v.message.content.parts) {
                                fullContent = parsed.v.message.content.parts[0] || '';
                            }
                        } else if (parsed.o === 'append' && parsed.p === '/message/content/parts/0') {
                            // Direct append to content
                            fullContent += parsed.v;
                        } else if (parsed.o === 'patch' && Array.isArray(parsed.v)) {
                            // Handle nested patches
                            for (const patch of parsed.v) {
                                if (patch.p === '/message/content/parts/0' && patch.o === 'append') {
                                    fullContent += patch.v;
                                }
                            }
                        } else if (Array.isArray(parsed.v)) {
                            // Handle array of patches directly
                            for (const patch of parsed.v) {
                                if (patch.p === '/message/content/parts/0' && patch.o === 'append') {
                                    fullContent += patch.v;
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('Error parsing JSON:', err, data);
                    }
                }
            }
        });

        response.data.on('end', () => {
            clearTimeout(streamTimeout);
            console.log('Stream complete');
            resolve({content: fullContent, conversationId});
        });

        response.data.on('error', (err) => {
            clearTimeout(streamTimeout);
            reject(err);
        });
    });

    // Parse the YYYY-MM date string
    const knowledgeCutoffDateInYyyyMm = result.content.trim();

    // Convert to timestamp for Prometheus (assumes the first day of the month)
    const knowledgeCutoffTimestamp = parseYearMonth(knowledgeCutoffDateInYyyyMm).timestamp;

    // Calculate degradation level
    let degradation = 0;
    if (knowledgeCutoffTimestamp >= 1717113600000) {
        // May 2024 timestamp
        degradation = 0;
    } else if (knowledgeCutoffTimestamp >= 1640822400000) {
        // January 2022 timestamp
        degradation = 1;
    } else if (knowledgeCutoffTimestamp >= 1609459200000) {
        degradation = 2;
    } else {
        throw new Error(`failed to parse knowledge cutoff date ${knowledgeCutoffDateInYyyyMm}`);
    }

    console.log(
        "Knowledge cutoff date:", knowledgeCutoffDateInYyyyMm,
        "Degradation level:", degradation,
        "Conversation ID:", result.conversationId,
        "Account:", account.name
    );

    return {
        knowledgeCutoffDateString: knowledgeCutoffDateInYyyyMm,
        knowledgeCutoffTimestamp: Math.floor(knowledgeCutoffTimestamp / 1000), // Convert to seconds
        degradation,
        conversationId: result.conversationId
    };
}

// Parse date strings in either YYYY-MM or YYYYMM format
function parseYearMonth(dateString) {
    // Remove any whitespace
    const cleanDateString = dateString.trim();

    let year, month;

    // Check if it's in YYYY-MM format
    if (cleanDateString.includes('-')) {
        [year, month] = cleanDateString.split('-').map(Number);
    }
    // Check if it's in YYYYMM format (6 digits)
    else if (/^\d{6}$/.test(cleanDateString)) {
        year = parseInt(cleanDateString.substring(0, 4), 10);
        month = parseInt(cleanDateString.substring(4, 6), 10);
    }
    // Invalid format
    else {
        throw new Error('Invalid date format. Expected YYYY-MM or YYYYMM');
    }

    // Validate year and month
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
        throw new Error('Invalid year or month values');
    }

    // Convert to timestamp for Prometheus (assumes the first day of the month)
    const knowledgeCutoffTimestamp = Date.UTC(year, month - 1, 1);

    return {
        year,
        month,
        timestamp: knowledgeCutoffTimestamp
    };
}

module.exports = {handleMetrics, performDegradationCheckForAccount, performDatabaseMaintenance}