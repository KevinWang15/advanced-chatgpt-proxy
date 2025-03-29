let interceptionIsSetup = false;
let readyState = false;
let workerId = null;
let wsUrl = 'ws://localhost:8234/ws';
let serverUrl = 'http://localhost:8234';
let socket = null;
let workerStatus = {
    connected: false,
    busy: false,
    lastAction: 'Initializing',
    busySince: null
};
let reconnectInterval = null;
let statusOverlay = null;

// Initialize content script
function initialize() {
    readyState = true;

    setTimeout(() => {
        createStatusOverlay();
    }, 2000);

    // Inject the interception script
    injectInterceptionScript();

    // Set up reconnection interval
    setTimeout(() => {
        registerAsWorker();
    }, 5000); // wait for chatgpt to load before trying to connect

    // Check if we've been busy for over 30 minutes and reload if so
    setInterval(() => {
        if (
            workerStatus.busy &&
            workerStatus.busySince &&
            (Date.now() - workerStatus.busySince) > 30 * 60 * 1000
        ) {
            console.warn('Worker has been busy for more than 30 minutes. Reloading...');
            unregisterWorker().then(() => {
                window.location.href = "/";
                window.location.reload();
            });
        }
    }, 10000);
}

// Function to create status overlay
function createStatusOverlay() {
    statusOverlay = document.createElement('div');
    statusOverlay.id = 'worker-status-overlay';

    // Style the overlay
    Object.assign(statusOverlay.style, {
        position: 'fixed',
        top: '10px',
        right: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '5px',
        zIndex: '9999',
        fontSize: '12px',
        pointerEvents: 'none',
        transition: 'opacity 0.3s ease',
        boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)'
    });

    updateStatusOverlay();
    document.body.appendChild(statusOverlay);
}

// Reload at random times if idle
setInterval(() => {
    if (!workerStatus.busy) {
        unregisterWorker().finally(() => {
            window.location.href = "/";
            window.location.reload();
        });
    }
}, 60 * 60 * 1000 * Math.random());

// Function to update the status overlay
function updateStatusOverlay() {
    if (!statusOverlay) return;

    const statusColor = workerStatus.connected ? 'rgb(75, 181, 67)' : 'rgb(220, 53, 69)';
    const busyIndicator = workerStatus.busy ? '⚡ BUSY' : '💤 IDLE';

    statusOverlay.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <span style="height: 8px; width: 8px; background-color: ${statusColor}; border-radius: 50%; display: inline-block; margin-right: 6px;"></span>
            <span style="font-weight: bold;">${workerStatus.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        </div>
        <div><b>Worker ID:</b> ${(workerId || '').substring(0, 12) || 'None'}</div>
        <div><b>Status:</b> ${busyIndicator}</div>
        <div style="font-size: 10px; margin-top: 4px; opacity: 0.8;">Last: ${workerStatus.lastAction}</div>
    `;
}

// Function to unregister the worker from the server
async function unregisterWorker() {
    if (!workerId) {
        console.log('No worker ID to unregister');
        return Promise.resolve();
    }

    console.log(`Unregistering worker ${workerId}`);
    workerStatus.lastAction = 'Unregistering';
    updateStatusOverlay();

    try {
        const response = await fetch(`${serverUrl}/unregister-worker`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({workerId})
        });

        const data = await response.json();
        console.log('Unregister response:', data);

        // Clean up local state
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.close();
        }

        workerId = null;
        workerStatus.connected = false;
        updateStatusOverlay();

        return data;
    } catch (error) {
        console.error('Failed to unregister worker:', error);
        // Still clean up local state even if server request fails
        workerId = null;
        workerStatus.connected = false;
        updateStatusOverlay();

        // Re-throw to allow caller to handle
        throw error;
    }
}

// Function to register this tab as a worker
async function registerAsWorker() {
    if (workerId) {
        console.log(`Already registered as worker ${workerId}`);
        return;
    }

    try {
        const response = await fetch(`${serverUrl}/register-worker`, {
            method: 'POST'
        });
        const data = await response.json();
        workerId = data.workerId;
        workerStatus.lastAction = 'Registered';
        updateStatusOverlay();
        connectWebSocket();
    } catch (error) {
        console.error('Failed to register worker:', error);
        workerStatus.lastAction = 'Registration failed';
        workerStatus.connected = false;
        updateStatusOverlay();
    }
}

function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.CONNECTING) {
        console.log('WebSocket already connecting');
        return;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected');
        return;
    }

    if (socket) {
        socket.close();
    }

    socket = new WebSocket(`${wsUrl}?workerId=${workerId}`);

    socket.onopen = () => {
        console.log('WebSocket connection established for worker', workerId);
        workerStatus.connected = true;
        workerStatus.lastAction = 'Connected';
        updateStatusOverlay();
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'stop_generation') {
            if (window.location.href.includes(data.conversationId)) {
                const stopButton = document.querySelector('button[aria-label="Stop streaming"]');
                if (stopButton) {
                    stopButton.click();
                    unregisterWorker().finally(() => {
                        setTimeout(() => {
                            window.location.href = "/"; // force a reload to get rid of all the nasty cache
                        }, 1000);
                    });
                }
            }
        }
        if (data.type === 'task') {
            console.log('Received task via WebSocket:', data.task);
            workerStatus.busy = true;
            workerStatus.busySince = Date.now();
            workerStatus.lastAction = `Processing: ${data.task.type}`;
            updateStatusOverlay();

            executeTask(data.task);
        }
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        workerStatus.connected = false;
        workerStatus.lastAction = 'Connection error';
        // Clear worker ID to force re-registration
        workerId = null;
        updateStatusOverlay();
    };

    socket.onclose = () => {
        console.log('WebSocket connection closed');
        workerStatus.connected = false;
        workerStatus.lastAction = 'Disconnected';
        // Clear worker ID to force re-registration
        workerId = null;
        updateStatusOverlay();
        // Reconnection will be handled by the interval
    };
}

// Function to inject the interception script into the page
function injectInterceptionScript() {
    if (interceptionIsSetup) return;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function () {
        script.remove();
        interceptionIsSetup = true;
    };
}

let taskExpectedUrl = '';

async function executeTask(task) {
    taskExpectedUrl = task.type === 'conversation'
        ? "https://chatgpt.com/backend-api/conversation"
        : task.request.url;

    try {
        switch (task.type) {
            case "conversation":
                return await chatSimulateUser(task);
            case "fetch":
                window.postMessage({
                    type: 'CMD_DO_FETCH',
                    request: task.request
                });
                break;
        }
    } catch (error) {
        console.error('Error executing task:', error);
        setTimeout(() => {
            unregisterWorker().finally(() => {
                window.location.href = "/";
            });
        }, 10000);
    }
}

async function chatSimulateUser(task) {
    window.postMessage({
        type: 'CMD_NAVIGATE',
        url: "/?model"
    });
    await pollUntil(() => window.location.href.endsWith("/?model"));

    let expectedPath = '/';
    if (task.conversation_id) {
        expectedPath = '/c/' + task.conversation_id;
    }
    expectedPath += "?model=" + task.model;
    window.postMessage({
        type: 'CMD_NAVIGATE',
        url: expectedPath
    });
    await pollUntil(() => window.location.href.endsWith(expectedPath));
    await sleep(50); // js is async so changing the url doesn't immediately change the model
    if (expectedPath.includes("/c/")) {
        await pollUntil(() => Array.from(document.querySelectorAll('div[data-message-id]')).length);
    }

    window.postMessage({
        type: 'CMD_SET_PREFERRED_CONVERSATION_RAW_PAYLOAD',
        payload: {...task.raw_payload, path_to_message: undefined},
    });
    window.postMessage({
        type: 'CMD_SET_PREFERRED_MESSAGE_ID',
        id: task.preferred_message_id,
    });
    if (task.action === "variant") {
        const parentMessage = await findParentMessage(task);
        const messageToRegenerate = await pollUntil(() =>
            parentMessage.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement.nextSibling
        );

        messageToRegenerate.querySelector('.group\\/conversation-turn').dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
        const regenerateButton = await pollUntil(
            () => {
                const buttons = messageToRegenerate.querySelectorAll('div.items-center button');
                return buttons[buttons.length - 1];
            }
        );

        const tryAgainButton = await pollUntil(
            async () => {
                regenerateButton.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
                return await pollUntil(() => (Array.from(document.querySelectorAll("div[role='menuitem']")) || []).filter(x => x.innerText.startsWith("Try again"))[0]);
            }
        );

        tryAgainButton.click();

        return true;
    }

    const mainRoutine = async function () {
        const sendButton = await pollUntil(
            async () => {
                let textarea = document.querySelector('#prompt-textarea');
                const url = new URL(window.location.href);
                const ok = !!textarea && expectedPath.includes(url.pathname);
                if (!ok) {
                    return false;
                }
                textarea.innerText = '...';
                return await pollUntil(() => {
                    let element = document.querySelector('button[data-testid="send-button"]');
                    if (!element) {
                        return false;
                    }
                    if (element.getAttribute('aria-label') !== 'Send prompt') {
                        return false;
                    }
                    return element;
                });
            }
        );

        let deepResearchBtn = document.querySelector('button[aria-label="Deep research"]');
        let deepResearchBtnPressed = deepResearchBtn.getAttribute('aria-pressed');
        if (deepResearchBtnPressed === 'false') {
            deepResearchBtnPressed = false;
        }
        if (deepResearchBtnPressed === 'true') {
            deepResearchBtnPressed = true;
        }
        if (task.raw_payload.system_hints && task.raw_payload.system_hints[0] === 'research') {
            if (!deepResearchBtnPressed) {
                deepResearchBtn.click();
                await pollUntil(() => deepResearchBtn.getAttribute('aria-pressed') === 'true')
                await sleep(50);
            }
        } else {
            if (deepResearchBtnPressed) {
                deepResearchBtn.click();
                await pollUntil(() => deepResearchBtn.getAttribute('aria-pressed') === 'false')
                await sleep(50);
            }
        }

        let searchBtn = document.querySelector('button[aria-label="Search"]');
        let searchBtnPressed = searchBtn.getAttribute('aria-pressed');
        if (searchBtnPressed === 'false') {
            searchBtnPressed = false;
        }
        if (searchBtnPressed === 'true') {
            searchBtnPressed = true;
        }
        if (task.raw_payload.force_use_search) {
            if (!searchBtnPressed) {
                searchBtn.click();
                await pollUntil(() => searchBtn.getAttribute('aria-pressed') === 'true')
                await sleep(50);
            }
        } else {
            if (searchBtnPressed) {
                searchBtn.click();
                await pollUntil(() => searchBtn.getAttribute('aria-pressed') === 'false')
                await sleep(50);
            }
        }

        pollUntil(async () => {
            sendButton.click();
            return await pollUntil(async () => {
                return sendButton.getAttribute('aria-label') !== 'Send prompt';
            })
        });
    };

    if (!task.raw_payload.conversation_id) {
        // new conversation
        await mainRoutine();
    } else {
        const x = async (b) => {
            b.querySelector('.group\\/conversation-turn').dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
            const editMessageBtn = await pollUntil(() => b.querySelector("button[aria-label='Edit message']"));
            editMessageBtn.click();
            const textArea = await pollUntil(() => b.querySelector('textarea'));
            textArea.value = '...';
            const sendButton = b.querySelector('button.btn-primary');
            sendButton.click();
        };
        const parentMessage = await findParentMessage(task);
        if (parentMessage) {
            const a = parentMessage.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement;
            const b = a.nextSibling;
            if (b && b.innerText && b.querySelector('div[data-message-id]')) {
                await x(b);
                return true;
            } else {
                await mainRoutine();
            }
        } else {
            const b = document.querySelector('div[data-message-author-role="user"]').parentElement.parentElement.parentElement.parentElement.parentElement.parentElement;
            await x(b);
            return true;
        }
    }

    return true;
}

// Set up message passing from injected script to content script
window.addEventListener('message', function (event) {
    // Only accept messages from the same frame
    if (event.source !== window) return;

    if (event.data.type && event.data.type === 'FROM_PAGE') {
        // Forward the intercepted chunk to the server via WebSocket
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'network',
                workerId: workerId,
                requestId: event.data.requestId,
                url: event.data.url,
                text: event.data.text,
                isDone: event.data.isDone
            }));

            // If the response is complete, mark as not busy
            if (event.data.isDone && (event.data.url === taskExpectedUrl || event.data.url.replace('backend-alt', 'backend-api') === taskExpectedUrl)) {
                taskExpectedUrl = '';
                workerStatus.busy = false;
                workerStatus.busySince = null;
                workerStatus.lastAction = 'Task completed';
                updateStatusOverlay();
                unregisterWorker().finally(() => {
                    window.location.href = "/"; // force a reload to get rid of all the nasty cache
                });
            }

            // Acknowledge receipt to the page script
            window.postMessage({
                type: 'FROM_CONTENT',
                received: true,
            }, '*');
        } else {
            console.error('WebSocket is not connected, cannot send chunk');
            workerStatus.lastAction = 'Failed to send response';
            // Do NOT set busy to false here as we didn't receive isDone
            updateStatusOverlay();
        }
    }

    if (event.data.type && event.data.type === 'EXECUTE_WORKER_TASK') {
        console.log('Received task command directly from page:', event.data);

        if (workerStatus.busy) {
            console.warn('Worker is busy, ignoring task command from page:', event.data.taskId);
            return;
        }

        if (event.data.task) {
            // Use a unique ID for page-initiated tasks if needed, or use one provided
            const currentPageCommandRequestId = event.data.taskId || `page-${Date.now()}`;

            workerStatus.busy = true;
            workerStatus.busySince = Date.now();
            workerStatus.lastAction = `Processing Page Task (${(event.data.task.type || 'unknown').substring(0, 15)}): ${currentPageCommandRequestId.substring(0, 8)}`;
            updateStatusOverlay();

            // Execute the task received from the page
            executeTask(event.data.task);
        } else {
            console.error('Page command EXECUTE_WORKER_TASK missing "task" payload.');
            window.postMessage({
                type: 'WORKER_TASK_REJECTED',
                reason: 'Invalid task format',
                taskId: event.data.taskId
            }, '*');
        }
    }
});

initialize();

const pollUntil = async (
    condition,
    options = {
        interval: 5,
        timeout: 5000
    }
) => {
    const startTime = Date.now();

    while (Date.now() - startTime < options.timeout) {
        try {
            const result = await condition();
            if (result) return result;
        } catch (ex) {
            console.warn(ex);
        }
        await new Promise(resolve => setTimeout(resolve, options.interval));
    }

    throw new Error('Polling timed out');
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function findParentMessage(task) {
    // First attempt to find parent message directly
    let parentMessageToLookFor = task.raw_payload.parent_message_id;

    if (task.raw_payload.system_hints && task.raw_payload.system_hints[0] === 'research') {
        parentMessageToLookFor = task.raw_payload.path_to_message[task.raw_payload.path_to_message.length - 3];
    }

    let parentMessage = document.querySelector(`div[data-message-id="${parentMessageToLookFor}"]`);
    if (parentMessage) return parentMessage;

    // Track pages we've completed left traversal for
    const completedLeftTraversal = {};

    if (task.raw_payload.path_to_message.length === 2) {
        return null;
    }

    while (true) {
        // Find first message that doesn't match expected path
        const messages = document.querySelectorAll('div[data-message-id]');
        let mismatchMessage = null;
        let expectedNodeId = null;

        for (let i = 0; i < messages.length; i++) {
            if (messages[i].getAttribute('data-message-id') !== task.raw_payload.path_to_message[i]) {
                mismatchMessage = messages[i];
                expectedNodeId = task.raw_payload.path_to_message[i];
                break;
            }
        }

        // If all messages match path, check if parent exists now
        if (!mismatchMessage) {
            parentMessage = document.querySelector(`div[data-message-id="${parentMessageToLookFor}"]`);
            if (parentMessage) {
                return parentMessage;
            } else {
                // this is for the "best effort" - e.g. when some generation failed, the message id may not show
                return messages[messages.length - 1];
            }
        }

        // Interact with the mismatched message
        mismatchMessage.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
        await sleep(100);

        const messageId = mismatchMessage.getAttribute('data-message-id');
        const navigation = mismatchMessage.parentElement.parentElement;

        // First search left (previous) until exhausted, then search right
        if (!completedLeftTraversal[messageId]) {
            const prevButton = navigation.querySelector('button[aria-label="Previous response"]');
            if (prevButton && !prevButton.hasAttribute('disabled')) {
                prevButton.click();
                await sleep(100);
            } else {
                // Mark that we've completed left traversal for this node
                completedLeftTraversal[messageId] = true;
            }
        } else {
            // Check if expected next node is now available
            if (document.querySelector(`div[data-message-id="${expectedNodeId}"]`)) {
                parentMessage = document.querySelector(`div[data-message-id="${parentMessageToLookFor}"]`);
                if (parentMessage) return parentMessage;
            }

            // Try going to next page if available
            const nextButton = navigation.querySelector('button[aria-label="Next response"]');
            if (nextButton && !nextButton.hasAttribute('disabled')) {
                nextButton.click();
                await sleep(100);
            } else {
                throw "Cannot navigate to find required message";
            }
        }
    }
}
