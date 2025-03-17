const workerId = "worker-" + Math.random().toString(36).substring(2, 9);
let isWorking = false;
let isConnected = false;

let delete_conversation_immediately_afterwards = false;
let theAccessToken = "";

setTimeout(() => {
    if (!isWorking) {
        destroy();
    }
}, 10 * 60 * 1000); // 10 minutes timeout, if not working, then reload, to make sure things are always fresh

setTimeout(() => {
    if (!isConnected) {
        destroy();
    }
}, 30 * 1000);

setInterval(() => {
    try {
        if (document.querySelectorAll("h2")[0].innerText === 'Content failed to load') {
            destroy();
        }
    } catch (e) {
    }
}, 5000);

// set up network interception
(function setupInterception() {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        // Call the original fetch
        let originalResponse;
        try {
            originalResponse = await originalFetch.apply(this, args);
        } catch (error) {
            console.error('Error in intercepted fetch:', error);
            throw error;
        }

        // Skip if response has no body or isn't streaming
        if (!originalResponse.body) {
            return originalResponse;
        }


        if (url.replace('backend-alt', 'backend-api') == "https://chatgpt.com/backend-api/conversation") {
            socket.emit("sendConversationHeader", {
                status: originalResponse.status,
                header: Object.fromEntries(originalResponse.headers.entries())
            });
        }


        try {
            // Set up a transform stream to process chunks
            const reader = originalResponse.body.getReader();
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        while (true) {
                            const {done, value} = await reader.read();

                            if (done) {
                                controller.close();
                                break;
                            }

                            // Process the chunk (Uint8Array)
                            const decoder = new TextDecoder();
                            const text = decoder.decode(value, {stream: true});

                            socket.emit('network', {
                                url: url,
                                text: text,
                            });

                            // Pass the chunk through unchanged
                            controller.enqueue(value);
                        }

                        socket.emit('network', {
                            url: url,
                            isDone: true,
                        });

                        if (url.replace('backend-alt', 'backend-api') == "https://chatgpt.com/backend-api/conversation") {
                            console.log("Done work");
                            if (delete_conversation_immediately_afterwards) {
                                if (window.location.href.includes("/c/")) {
                                    const conversationId = window.location.href.split("/").pop();
                                    // fetch("https://chatgpt.com/api/auth/session").then(response => response.json())
                                    //     .then(data => {
                                    //         fetch("https://chatgpt.com/backend-api/conversation/" + conversationId, {
                                    //             "headers": {
                                    //                 "accept": "*/*",
                                    //                 "authorization": "Bearer " + data.accessToken,
                                    //                 "content-type": "application/json",
                                    //             },
                                    //             "body": "{\"is_visible\":false}",
                                    //             "method": "PATCH",
                                    //             "mode": "cors",
                                    //             "credentials": "include"
                                    //         })
                                    //     })

                                    fetch("https://chatgpt.com/backend-api/conversation/" + conversationId, {
                                        "headers": {
                                            "accept": "*/*",
                                            "authorization": "Bearer " + theAccessToken,
                                            "content-type": "application/json",
                                        },
                                        "body": "{\"is_visible\":false}",
                                        "method": "PATCH",
                                        "mode": "cors",
                                        "credentials": "include"
                                    })

                                    await new Promise((resolve) => {
                                        setTimeout(resolve, 1000)
                                    });
                                }
                            }
                            setTimeout(() => {
                                destroy();
                            });
                        }

                    } catch (error) {
                        console.error('Error in stream processing:', error);
                        controller.error(error);
                    }
                }
            });

            // Create a new response with the transformed body
            return new Response(stream, {
                headers: originalResponse.headers,
                status: originalResponse.status,
                statusText: originalResponse.statusText
            });
        } catch (error) {
            console.error('Error in response transformation:', error);
            return originalResponse;
        }
    };
})()

function injectionIsReady() {
    return window.inj1 && window.inj2 && window.inj3 && window.inj4 && window.inj5;
}


function onDOMReady(callback) {
    if (document.readyState === "loading") {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        // DOM is already ready (interactive or complete)
        callback();
    }
}

let DOMReady = false;
onDOMReady(function () {
    DOMReady = true;
    setTimeout(() => {
        if (!injectionIsReady()) {
            showErrorToast("ChatGPT injection is not working.\nMake sure you are using the mitm proxy that comes with advanced-chatgpt-proxy, or the mitm proxy needs updating. Or you may need to clear browser cache.", 10000);
            setTimeout(() => {
                window.location.reload();
            }, 8000);
        }
    }, 5000);
});

/**
 * Creates and displays a toast notification for error messages
 * @param {string} message - The error message to display
 * @param {number} duration - Duration in milliseconds to show the toast (default: 3000ms)
 */
function showErrorToast(message, duration = 3000) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
    `;
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.cssText = `
    background-color: #f44336;
    color: white;
    padding: 16px;
    border-radius: 4px;
    margin-bottom: 10px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-width: 250px;
    max-width: 350px;
    transform: translateX(100%);
    opacity: 0;
    transition: transform 0.3s ease-out, opacity 0.3s ease-out;
  `;

    // Create error icon
    const icon = document.createElement('div');
    icon.innerHTML = '⚠️';
    icon.style.cssText = `
    margin-right: 12px;
    font-size: 20px;
  `;

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.style.cssText = `
    flex-grow: 1;
    font-size: 14px;
    font-weight: 500;
  `;

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText = `
    background: none;
    border: none;
    color: white;
    font-size: 20px;
    font-weight: bold;
    cursor: pointer;
    margin-left: 10px;
  `;

    // Assemble toast
    toast.appendChild(icon);
    toast.appendChild(messageElement);
    toast.appendChild(closeButton);
    toastContainer.appendChild(toast);

    // Trigger entrance animation
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    }, 10);

    // Set up close events
    const removeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';

        setTimeout(() => {
            if (toast.parentNode) {
                toastContainer.removeChild(toast);
                // Remove container if empty
                if (toastContainer.children.length === 0) {
                    document.body.removeChild(toastContainer);
                }
            }
        }, 300);
    };

    closeButton.addEventListener('click', removeToast);

    // Auto dismiss after duration
    setTimeout(removeToast, duration);

    // Return the toast element in case further manipulation is needed
    return toast;
}


let heartbeatInterval = null;
let socket = null;

whenReady(function () {
    // Function to inject CSS into the document head
    function injectCSS() {
        const css = `
      #workerOverlay {
        position: fixed;
        top: 15px;
        right: 15px;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        font-size: 14px;
        padding: 12px 15px;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        z-index: 999999;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        max-width: 250px;
        transition: all 0.3s ease;
      }
      #workerOverlay p {
        margin: 5px 0;
        display: flex;
        align-items: center;
      }
      #workerOverlay .emoji {
        font-size: 18px;
        margin-right: 8px;
      }
      #workerOverlay.connected {
        background: rgba(39, 174, 96, 0.9);
      }
      #workerOverlay.disconnected {
        background: rgba(231, 76, 60, 0.9);
      }
      #workerOverlay.connecting {
        background: rgba(52, 152, 219, 0.9);
      }
    `;
        const style = document.createElement("style");
        style.type = "text/css";
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    // Function to create the overlay and its inner elements
    function createOverlay() {
        const overlay = document.createElement("div");
        overlay.id = "workerOverlay";
        overlay.className = "connecting";

        const workerIdDisplay = document.createElement("p");
        workerIdDisplay.id = "workerIdDisplay";
        const workerEmoji = document.createElement("span");
        workerEmoji.className = "emoji";
        workerEmoji.textContent = "👷";
        workerIdDisplay.appendChild(workerEmoji);
        const workerIdText = document.createElement("span");
        workerIdDisplay.appendChild(workerIdText);
        overlay.appendChild(workerIdDisplay);

        const connectionStatus = document.createElement("p");
        connectionStatus.id = "connectionStatus";
        const statusEmoji = document.createElement("span");
        statusEmoji.className = "emoji";
        statusEmoji.id = "statusEmoji";
        statusEmoji.textContent = "🔄";
        connectionStatus.appendChild(statusEmoji);
        const statusText = document.createElement("span");
        statusText.id = "statusText";
        connectionStatus.appendChild(statusText);
        overlay.appendChild(connectionStatus);

        document.body.appendChild(overlay);
        return overlay;
    }

    // Function to load a script dynamically
    function loadScript(url, callback) {
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.src = url;
        script.onload = callback;
        document.head.appendChild(script);
    }

    // Inject CSS and create the overlay
    injectCSS();
    const overlay = createOverlay();
    const workerIdDisplay = document.getElementById("workerIdDisplay").querySelector("span:last-child");
    const statusText = document.getElementById("statusText");
    const statusEmoji = document.getElementById("statusEmoji");

    // Generate a unique workerId (using a simple random string generator)
    workerIdDisplay.textContent = `ID: ${workerId}`;
    statusText.textContent = "Connecting...";

    // Load the Socket.io client library, then run the main logic
    loadScript("https://cdn.oaistatic.com/socket.io.min.js", function () {
        // Create socket connection with the workerId as query param
        socket = io("https://aaaaa.chatgpt.com/socketio", {
            query: {workerId},
        });

        // Track the time when we last received a pong
        let lastPongTimestamp = Date.now();
        // Heartbeat parameters
        const HEARTBEAT_INTERVAL_MS = 500;
        const HEARTBEAT_TIMEOUT_MS = 1100;

        // Start heartbeat interval
        heartbeatInterval = setInterval(() => {
            if (!socket.connected) {
                console.warn("Socket not connected; destroying worker.");
                destroy();
                return;
            }

            const now = Date.now();
            // Check if it's been too long since the last pong
            if (now - lastPongTimestamp > HEARTBEAT_TIMEOUT_MS) {
                console.warn("No pong in a while; destroying worker.");
                destroy();
                return;
            }

            socket.emit("heartbeat");
        }, HEARTBEAT_INTERVAL_MS);

        // On socket connection, update overlay
        socket.on("connect", () => {
            console.log("Socket connected for worker", workerId);
            statusText.textContent = "Connected";
            statusEmoji.textContent = "✅";
            overlay.className = "connected";
            isConnected = true;
        });

        // On receiving pong, update timestamp
        socket.on("pong", () => {
            console.log("Received pong for worker", workerId);
            lastPongTimestamp = Date.now();
        });

        // If the socket disconnects, destroy the worker
        socket.on("disconnect", () => {
            console.warn("Socket disconnected; destroying worker.");
            statusText.textContent = "Disconnected";
            statusEmoji.textContent = "❌";
            overlay.className = "disconnected";
            setTimeout(destroy, 500);
        });
        socket.on("stopGeneration", async () => {
            const stopButton = document.querySelector('button[aria-label="Stop streaming"]');
            if (stopButton) {
                stopButton.click();
                setTimeout(() => {
                    destroy();
                }, 1000);
            }
        });
        // When assigned work from the server
        socket.on("assignWork", async (data) => {
            console.log("Received work assignment:", data);

            // Update status
            statusText.textContent = "Working...";
            statusEmoji.textContent = "⚡";
            isWorking = true;

            // Immediately acknowledge the work
            socket.emit("ackWork");

            setTimeout(() => {
                destroy();
            }, 30 * 60 * 1000); // it's impossible that work takes more than 30 minutes, if so it's stuck, and we should reload

            const doWork = async () => {
                const {task} = data;
                await window.oairouter.navigate('/?model');
                await pollUntil(() => window.location.href.endsWith("/?model"));

                let expectedPath = '/';
                if (task.conversation_id) {
                    expectedPath = '/c/' + task.conversation_id;
                }
                expectedPath += "?model=" + task.model;
                await window.oairouter.navigate(expectedPath);
                await pollUntil(() => window.location.href.endsWith(expectedPath));
                await sleep(350); // js is async so changing the url doesn't immediately change the model
                if (expectedPath.includes("/c/")) {
                    await pollUntil(() => Array.from(document.querySelectorAll('div[data-message-id]')).length);
                }

                window.hpcrp = {...task.raw_payload, path_to_message: undefined};
                window.hpcrp2 = {...task.raw_payload, path_to_message: undefined};
                window.hpmid = task.preferred_message_id;
                delete_conversation_immediately_afterwards = task.raw_payload.delete_conversation_immediately_afterwards;
                theAccessToken = task.raw_payload.theAccessToken;
                delete task.raw_payload.delete_conversation_immediately_afterwards;
                delete task.raw_payload.theAccessToken;

                if (task.action === "variant") {
                    const parentMessage = await findParentMessage(task);
                    const messageToRegenerate = await pollUntil(() =>
                        parentMessage.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement.nextSibling
                    );

                    if (!messageToRegenerate.innerText) {
                        // 这是error情况，应该拒绝掉… 用户发消息→AI回消息→用户发第二条消息但是失败，用户点了retry，会触发
                    }

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
                            await sleep(200);
                        }
                    } else {
                        if (deepResearchBtnPressed) {
                            deepResearchBtn.click();
                            await pollUntil(() => deepResearchBtn.getAttribute('aria-pressed') === 'false')
                            await sleep(200);
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
                            await sleep(200);
                        }
                    } else {
                        if (searchBtnPressed) {
                            searchBtn.click();
                            await pollUntil(() => searchBtn.getAttribute('aria-pressed') === 'false')
                            await sleep(200);
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

            try {
                await doWork()
            } catch (e) {
                console.error(e);
                setTimeout(destroy, 500);
            }
        });
    });
});

function whenReady(callback) {
    const i = setInterval(() => {
        if (DOMReady && injectionIsReady() && window.oairouter && window.oairouter.navigate) {
            clearInterval(i);
            callback();
        }
    }, 50);
}

// Clean up function to destroy the worker
function destroy() {
    console.log(`Destroying worker ${workerId}...`);
    clearInterval(heartbeatInterval);

    if (socket.connected) {
        socket.disconnect();
    }

    setTimeout(() => {
        window.location.href = "/";
    }, 500);
}

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


// play audio periodically to avoid chrome from throttling it
(() => {
    let audioCtx = null;
    const blipDuration = 0.2; // 200ms
    const intervalTime = 5000; // 5 seconds
    const blipFrequency = 660; // E5 note Hz
    const blipVolume = 0.2; // Adjust volume (0 to 1) - keep it audible but low


// Function to play the blip
    function playBlip() {
        if (!audioCtx || audioCtx.state !== 'running') {
            console.warn(`AudioContext not ready (state: ${audioCtx ? audioCtx.state : 'null'}). Skipping blip.`);
            // Attempt to resume if suspended - might need another click/interaction
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume().catch(e => console.error("Resume failed during playBlip:", e));
            }
            return;
        }

        const currentTime = audioCtx.currentTime;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(blipFrequency, currentTime);

        gainNode.gain.setValueAtTime(blipVolume, currentTime);
        gainNode.gain.linearRampToValueAtTime(0.0001, currentTime + blipDuration); // Ramp down

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start(currentTime);
        oscillator.stop(currentTime + blipDuration);

        // console.log(`Blip played at ${new Date().toLocaleTimeString()}`); // Uncomment for debugging
    }

    function startAudio() {
        // Prevent re-initialization or multiple intervals if somehow clicked again
        if (audioCtx && audioCtx.state === 'running') {
            console.log("Audio already initialized and running.");
            return;
        }

        console.log("User interaction detected. Initializing/Resuming AudioContext...");

        // Initialize AudioContext if needed
        if (!audioCtx) {
            try {
                window.AudioContext = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioContext();
                console.log("AudioContext created.");
            } catch (e) {
                console.error("Web Audio API failed to initialize.", e);
                statusElement.textContent = "Error: Web Audio API not supported or failed.";
                alert("Error: Web Audio API not supported or failed.");
                return; // Stop if context creation fails
            }
        }

        // Resume context if suspended (most likely state before first interaction)
        audioCtx.resume().then(() => {
            console.log(`AudioContext state: ${audioCtx.state}.`);
            if (audioCtx.state === 'running') {
                console.log("AudioContext running. Starting indefinite blip interval.");
                playBlip(); // Play first blip immediately
                // Start the interval - it will never be cleared in this version
                setInterval(playBlip, intervalTime);
            } else {
                // This shouldn't normally happen after a successful resume, but handle defensively
                console.error(`AudioContext is not running after resume attempt. State: ${audioCtx.state}`);
                alert(`Failed to start audio. State: ${audioCtx.state}`);
            }
        }).catch(e => {
            console.error("Error resuming AudioContext:", e);
            alert("Error resuming audio. Please try clicking again.");
        });
    }

    startAudio();
})()
