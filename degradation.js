const path = require("path");
const config = require(path.join(__dirname, process.env.CONFIG));
const {getInternalAuthenticationToken} = require("./services/auth");
const axios = require("axios");
const {v4: uuidv4} = require("uuid");
const {usageCounters} = require("./services/reverseproxy");


// Keep track of each account’s status
const accountStatusMap = {};

// Initialize the periodic check when the server starts
initializeCleanupJob();

/**
 * Schedule the next check for an account at a random time between 20 and 30 minutes.
 */
function scheduleNextCheckForAccount(account) {
    const nextDelay = getRandomMs(200, 300);
    setTimeout(async () => {
        await performDegradationCheckForAccount(account);
        scheduleNextCheckForAccount(account);
    }, nextDelay);
}

/**
 * Utility to get a random millisecond value between minMinutes and maxMinutes.
 */
function getRandomMs(minMinutes, maxMinutes) {
    // Calculate a random interval in the range [minMinutes, maxMinutes]
    const randomMinutes = Math.random() * (maxMinutes - minMinutes) + minMinutes;
    return Math.floor(randomMinutes * 60 * 1000);
}

/**
 * Perform the degradation check for a single account with retry logic
 */
async function performDegradationCheckForAccount(account) {
    const accountState = accountStatusMap[account.name];

    // Prevent multiple concurrent checks for this account
    if (accountState.checkInProgress) return;

    accountState.checkInProgress = true;
    let retries = 0;
    const maxRetries = 3;

    while (retries <= maxRetries) {
        try {
            console.log(`Performing degradation check for ${account.name} (attempt ${retries + 1})`);
            const result = await checkDegradation(account);

            // Update the account’s result and timestamp
            accountState.lastDegradationResult = result;
            accountState.lastCheckTime = Date.now();

            console.log(`Degradation check successful for ${account.name}`);
            accountState.checkInProgress = false;
            return;
        } catch (error) {
            retries++;
            console.error(`Degradation check failed for ${account.name} (attempt ${retries}):`, error);

            if (retries <= maxRetries) {
                console.log(`Retrying for ${account.name} in 1 minute...`);
                // Wait for 1 minute before retrying
                await new Promise(resolve => setTimeout(resolve, 60000));
            } else {
                console.error(`All retry attempts failed for ${account.name}`);
                // If all retries fail, set result to null to indicate "no data"
                accountState.lastDegradationResult = null;
                accountState.lastCheckTime = Date.now();
                accountState.checkInProgress = false;
                return;
            }
        }
    }
}

/**
 * Handle the HTTP request for metrics
 */
async function handleMetrics(req, res) {
    const {getAllAccounts} = require('./state/state');

    // Common metric definitions at the top
    let metricsOutput = `
# HELP chatgpt_knowledge_cutoff_date The knowledge cutoff date of the model in Unix timestamp
# TYPE chatgpt_knowledge_cutoff_date gauge
# HELP chatgpt_degradation The degradation level (0=not degraded, 1=slightly degraded, 2=severely degraded)
# TYPE chatgpt_degradation gauge
# HELP chatgpt_last_check_timestamp The timestamp of the last successful check
# TYPE chatgpt_last_check_timestamp gauge
`.trimStart();

    // Get all accounts that have workers connected
    const availableAccounts = getAllAccounts();

    for (const account of availableAccounts) {
        const accountState = accountStatusMap[account.name];

        // Skip accounts that don't have status data yet
        if (!accountState) continue;

        const {lastDegradationResult, lastCheckTime} = accountState;

        // If we have a valid result for this account, add it to the metrics output
        if (lastDegradationResult) {
            // Build the label string: {account_name="...", plan="..."}
            // Merge default label `account_name` with any custom labels in account.
            const labelObj = {account_name: account.name, ...account.labels};
            const labelString = Object.entries(labelObj)
                .map(([k, v]) => `${k}="${v}"`)
                .join(',');

            // Add each metric line with the appropriate labels
            metricsOutput += `
chatgpt_knowledge_cutoff_date{${labelString}} ${lastDegradationResult.knowledgeCutoffTimestamp}
chatgpt_degradation{${labelString}} ${lastDegradationResult.degradation}
chatgpt_last_check_timestamp{${labelString}} ${Math.floor(lastCheckTime / 1000)}
`;
        }
    }

    metricsOutput += `
# HELP chatgpt_usage_total The total number of user conversation requests
# TYPE chatgpt_usage_total counter
`;
    for (const [key, count] of Object.entries(usageCounters)) {
        // key is "account||model"
        const [accountName, model] = key.split("||");
        metricsOutput += `chatgpt_usage_total{account_name="${accountName}",model="${model}"} ${count}\n`;
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.status(200).send(metricsOutput);
}

/**
 * Initialize a cleanup job that runs every minute. If the last check time is
 * more than 35 minutes ago, clear the degradation-related metrics for that account.
 */
function initializeCleanupJob() {
    setInterval(() => {
        const now = Date.now();
        const cutoff = 35 * 60 * 1000; // 35 minutes in milliseconds

        for (const [accountName, accountState] of Object.entries(accountStatusMap)) {
            const {lastCheckTime} = accountState;

            // If lastCheckTime exists and is older than 35 minutes
            if (lastCheckTime && (now - lastCheckTime) > cutoff) {
                console.log(`Clearing degradation metrics for "${accountName}" due to inactivity (>35 min).`);

                // Setting this to null ensures that no degradation metrics appear for this account
                accountState.lastDegradationResult = null;
            }
        }
    }, 60 * 1000); // every minute
}

/**
 * Core function that talks to /backend-api/conversation for a specific account
 * and returns the parsed results.
 */
async function checkDegradation(account) {
    try {
        // Insert your internal token retrieval logic here
        const token = getInternalAuthenticationToken();

        const response = await axios({
            method: 'POST',
            url: 'http://127.0.0.1:' + config.centralServer.port + '/backend-api/conversation',
            headers: {
                'accept': 'text/event-stream',
                'content-type': 'application/json',
                'x-internal-authentication': token,
                'x-account-name': account.name
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
                theAccessToken: account.accessToken,
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
        const [year, month] = knowledgeCutoffDateInYyyyMm.split('-').map(Number);
        const knowledgeCutoffTimestamp = Date.UTC(year, month - 1, 1);

        // Calculate degradation level
        let degradation = 0;
        if (knowledgeCutoffTimestamp >= 1717113600000) {
            // May 2024 timestamp
            degradation = 0;
        } else if (knowledgeCutoffTimestamp >= 1640822400000) {
            // January 2022 timestamp
            degradation = 1;
        } else {
            degradation = 2;
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
    } catch (error) {
        console.error('Error checking degradation for account:', account.name, error);
        throw error;
    }
}

module.exports = {accountStatusMap, handleMetrics,  performDegradationCheckForAccount, scheduleNextCheckForAccount}