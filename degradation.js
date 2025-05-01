const path = require("path");
const config = require(path.join(__dirname, process.env.CONFIG));
const {getInternalAuthenticationToken} = require("./services/auth");
const axios = require("axios");
const {v4: uuidv4} = require("uuid");
const {usageCounters} = require("./services/reverseproxy");
const {getAllAccounts} = require("./state/state");


// Keep track of each account’s status
const accountStatusMap = {};

// Initialize the periodic check when the server starts
initializeCleanupJob();

setInterval(() => {
    const accounts = getAllAccounts();

    accounts.forEach(account => {
        const accountState = accountStatusMap[account.name];

        // If no accountState exists, skip this account
        if (!accountState) return;

        const {lastCheckTime} = accountState;

        // Check if last check time is less than 3 hours ago
        if (lastCheckTime && Date.now() - lastCheckTime < 3 * 60 * 60 * 1000) {
            // No need to perform a check if it's less than 3 hours ago
            return;
        }

        // If it's greater than 5 hours ago, perform a degradation check
        if (lastCheckTime && Date.now() - lastCheckTime > 5 * 60 * 60 * 1000) {
            // Introduce a jitter (1 to 5 minutes)
            const jitter = Math.floor(Math.random() * 5 + 1) * 60 * 1000; // 1 to 5 minutes in ms

            setTimeout(() => {
                console.log(`Performing degradation check for ${account.name} (Last check was more than 5 hours ago)`);
                performDegradationCheckForAccount(account);
            }, jitter);

            return;
        }

        // If it's between 3 and 5 hours ago, we perform the check with 10% chance
        if (lastCheckTime && Date.now() - lastCheckTime >= 3 * 60 * 60 * 1000 && Math.random() < 0.1) {
            // Introduce a jitter (1 to 5 minutes)
            const jitter = Math.floor(Math.random() * 5 + 1) * 60 * 1000; // 1 to 5 minutes in ms

            setTimeout(() => {
                console.log(`Performing degradation check for ${account.name} (Last check was between 3 and 5 hours ago, 10% chance)`);
                performDegradationCheckForAccount(account);
            }, jitter);
        }
    });
}, 600000);

/**
 * Perform the degradation check for a single account with retry logic
 */
async function performDegradationCheckForAccount(account) {
    const accountState = accountStatusMap[account.name];
    try {
        console.log(`Performing degradation check for ${account.name} (attempt ${retries + 1})`);

        // Update the account’s result and timestamp
        accountState.lastDegradationResult = await checkDegradation(account);
        accountState.lastCheckTime = Date.now();

        console.log(`Degradation check successful for ${account.name}`);
    } catch (error) {
        console.error(`Degradation check failed for ${account.name}:`, error);
        accountState.lastDegradationResult = null;
        accountState.lastCheckTime = Date.now();
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
# HELP chatgpt_load The current load of the account (0-100)
# TYPE chatgpt_load gauge
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

            // Get the load value from reverseproxy.js
            const {calculateAccountLoad} = require('./services/reverseproxy');
            const load = calculateAccountLoad(account.name);

            // Add each metric line with the appropriate labels
            metricsOutput += `
chatgpt_knowledge_cutoff_date{${labelString}} ${lastDegradationResult.knowledgeCutoffTimestamp}
chatgpt_degradation{${labelString}} ${lastDegradationResult.degradation}
chatgpt_last_check_timestamp{${labelString}} ${Math.floor(lastCheckTime / 1000)}
chatgpt_load{${labelString}} ${load}
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
        const cutoff = 6 * 60 * 60 * 1000;

        for (const [accountName, accountState] of Object.entries(accountStatusMap)) {
            const {lastCheckTime} = accountState;

            // If lastCheckTime exists and is older than 6 hours
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

module.exports = {accountStatusMap, handleMetrics, performDegradationCheckForAccount}