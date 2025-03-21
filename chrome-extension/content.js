let interceptionIsSetup = false;
let readyState = false;
let workerId = null;
let wsUrl = 'ws://localhost:8234/ws';
let serverUrl = 'http://localhost:8234';
let socket = null;
let currentRequestId = null;
let workerStatus = {
    connected: false,
    busy: false,
    lastAction: 'Initializing'
};
let reconnectInterval = null;
let statusOverlay = null;

// Initialize content script
function initialize() {
    readyState = true;

    setTimeout(() => {
        createStatusOverlay();
    }, 2000)

    // Inject the interception script
    injectInterceptionScript();

    // Set up reconnection interval
    setupReconnection();
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

setInterval(() => {
    if (!workerStatus.busy) {
        window.location.reload();
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

// Set up reconnection interval
function setupReconnection() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
    }
    reconnectInterval = setInterval(() => {
        if (!workerStatus.connected) {
            console.log('Attempting to register and reconnect...');
            workerStatus.lastAction = 'Reconnecting';
            updateStatusOverlay();

            workerId = null;
            registerAsWorker();
        }
    }, 1000);
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
                document.querySelector('button[aria-label="Stop streaming"]').click();
                setTimeout(() => {
                    window.location.href = "/"; // force a reload to get rid of all the nasty cache
                });
            }
        }
        if (data.type === 'task') {
            console.log('Received task via WebSocket:', data.task);
            currentRequestId = data.requestId;
            workerStatus.busy = true;
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
            window.location.reload();
        }, 10000);
    }
}

async function chatSimulateUser(task) {

    let expectedPath = '/';
    window.postMessage({
        type: 'CMD_NAVIGATE',
        url: "/?model"
    });

    await sleep(100);
    if (task.conversation_id) {
        expectedPath = '/c/' + task.conversation_id;
    }

    expectedPath += "?model=" + task.model;
    window.postMessage({
        type: 'CMD_NAVIGATE',
        url: expectedPath
    });

    await sleep(200);
    if (expectedPath.includes("/c/")) {
        await pollUntil(() => Array.from(document.querySelectorAll('div[data-message-id]')).length)
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
        // handle regenerate
        const parentMessage = await findParentMessage(task);
        const messageToRegenerate = await pollUntil(() => parentMessage.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement.nextSibling);

        messageToRegenerate.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
        await sleep(200);

        const regenerateButton = await pollUntil(
            () => {
                const buttons = messageToRegenerate.querySelectorAll('div.items-center button');
                return buttons[buttons.length - 1];
            });

        const tryAgainButton = await pollUntil(
            async () => {
                regenerateButton.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
                await sleep(200);
                return Array.from(document.querySelectorAll("div[role='menuitem']")).filter(x => x.innerText.startsWith("Try again"))[0];
            }
        );

        tryAgainButton.click();

        return true;
    }

    const mainRoutine = async function () {
        const sendButton = await pollUntil(
            () => {
                let textarea = document.querySelector('#prompt-textarea');
                const url = new URL(window.location.href);
                const ok = !!textarea && url.pathname + url.search + url.hash === expectedPath;
                if (!ok) {
                    return false;
                }
                textarea.innerText = '...';
                let element = document.querySelector('button[data-testid="send-button"]');
                if (!element) {
                    return false;
                }
                if (element.getAttribute('aria-label') !== 'Send prompt') {
                    return false;
                }
                return element;
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
                await sleep(200);
                deepResearchBtn.click();
                await sleep(200);
            }
        } else {
            if (deepResearchBtnPressed) {
                await sleep(200);
                deepResearchBtn.click();
                await sleep(200);
            }
        }

        pollUntil(async () => {
            sendButton.click();
            await sleep(100);
            return sendButton.getAttribute('aria-label') !== 'Send prompt';
        });
    }

    if (!task.raw_payload.conversation_id) {
        // new conversation
        await mainRoutine();
    } else {
        const parentMessage = await findParentMessage(task);
        if (parentMessage) {
            const a = parentMessage.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement;
            const b = a.nextSibling;
            if (b.innerText) {
                // editing message
                const editMessageBtn = b.querySelector('div[data-message-author-role="user"]').querySelector("button[aria-label='Edit message']");
                editMessageBtn.click();
                const textArea = await pollUntil(() => b.querySelector('textarea'));
                textArea.value = '...';
                const sendButton = b.querySelector('button.btn-primary');
                sendButton.click();
                return true;
            } else {
                // sending new message
                await mainRoutine();
            }
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
            if (event.data.isDone && event.data.url.replace('backend-alt', 'backend-api') === taskExpectedUrl) {
                taskExpectedUrl = '';
                workerStatus.busy = false;
                workerStatus.lastAction = 'Task completed';
                updateStatusOverlay();
                window.location.href = "/"; // force a reload to get rid of all the nasty cache
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
});

// Clean up function for when the page is unloaded
function cleanup() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    }

    if (statusOverlay && statusOverlay.parentNode) {
        statusOverlay.parentNode.removeChild(statusOverlay);
    }
}

// Set up cleanup on page unload
window.addEventListener('beforeunload', cleanup);

initialize();

const pollUntil = async (
    condition,
    options = {
        interval: 20,
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
            if (parentMessage) return parentMessage;
            throw "Parent message not found and no path mismatch detected";
        }

        // Interact with the mismatched message
        mismatchMessage.dispatchEvent(new PointerEvent("pointerover", {bubbles: true}));
        await sleep(200);

        const messageId = mismatchMessage.getAttribute('data-message-id');
        const navigation = mismatchMessage.parentElement.parentElement;

        // First search left (previous) until exhausted, then search right
        if (!completedLeftTraversal[messageId]) {
            const prevButton = navigation.querySelector('button[aria-label="Previous response"]');
            if (prevButton && !prevButton.hasAttribute('disabled')) {
                prevButton.click();
                await sleep(200);
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
                await sleep(200);
            } else {
                throw "Cannot navigate to find required message";
            }
        }
    }
}
