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

                            // Send the intercepted chunk to the content script
                            window.postMessage({
                                type: 'FROM_PAGE',
                                url: url,
                                text: text
                            }, '*');

                            // Pass the chunk through unchanged
                            controller.enqueue(value);
                        }
                        window.postMessage({
                            type: 'FROM_PAGE',
                            url: url,
                            isDone: true
                        }, '*');
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

// Listen for messages from the content script
window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data.type && event.data.type === 'CMD_DO_FETCH') {
        window.oaiapi.fetch2(event.data.request.url, {
            ...event.data.request,
            url: undefined,
            body: JSON.stringify(event.data.request.body)
        });
    }
    if (event.data.type && event.data.type === 'CMD_SET_PREFERRED_MESSAGE_ID') {
        window.hpmid = event.data.id;
    }
    if (event.data.type && event.data.type === 'CMD_SET_PREFERRED_CONVERSATION_RAW_PAYLOAD') {
        window.hpcrp = event.data.payload;
        window.hpcrp2 = event.data.payload;
    }
    if (event.data.type && event.data.type === 'CMD_NAVIGATE') {
        window.oairouter.navigate(event.data.url);
    }
});


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

onDOMReady(function () {
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
