// Function to inject the interception script into the page
function injectInterceptionScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    (document.head || document.documentElement).appendChild(script);
}

setTimeout(() => {
    injectInterceptionScript();
}, 1000)
