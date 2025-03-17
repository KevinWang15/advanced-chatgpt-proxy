// Function to inject the interception script into the page
function injectInterceptionScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    (document.head || document.documentElement).appendChild(script);
}

setTimeout(() => {
    injectInterceptionScript();
}, 1000)


window.addEventListener('message', function (event) {
    // Only accept messages from the same frame
    if (event.source !== window) return;

    if (event.data.type === 'SETUP_EXTENSION') {
        // Forward the message to the background script
        chrome.runtime.sendMessage(event.data, function(response) {
            // Forward the acknowledgment back to the page
            if (response && response.success) {
                window.postMessage({
                    type: 'SETUP_COMPLETE'
                }, '*');
            }
        });
    }
}, false);
