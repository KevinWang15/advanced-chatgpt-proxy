// Import TabJanitor
let tabJanitor = null;

// Initialize TabJanitor when extension starts
chrome.runtime.onInstalled.addListener(() => {
    console.log('ChatGPT Proxy Extension installed/updated');
    initializeTabJanitor();
});

// Also initialize on startup in case extension was already installed
chrome.runtime.onStartup.addListener(() => {
    console.log('ChatGPT Proxy Extension started');
    initializeTabJanitor();
});

// Initialize immediately when background script loads
initializeTabJanitor();

async function initializeTabJanitor() {
    try {
        // Dynamically import the TabJanitor
        const { default: TabJanitor } = await import('./tabJanitor.js');
        tabJanitor = new TabJanitor();
        console.log('Tab Janitor initialized');
    } catch (error) {
        console.error('Failed to initialize Tab Janitor:', error);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_CHATGPT') {
        const url = 'https://chatgpt.com/';
        for (let i = 0; i < 5; i++) {
            chrome.tabs.create({url});
        }
    }

    if (message.type === 'SETUP_EXTENSION') {
        const {accountData} = message;

        // Save account data to Chrome storage
        chrome.storage.local.set({currentAccountData: accountData}, () => {
            console.log('Account data saved');

            if (accountData.cookie) {
                (async function setCookies() {
                    await chrome.cookies.set(getCookie(accountData.cookie));
                    await chrome.cookies.set({
                        name: 'oai-locale',
                        domain: ".chatgpt.com",
                        url: `https://chatgpt.com/`,
                        path: "/",
                        secure: true,
                        value: "en-US",
                        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
                    });

                    sendResponse({success: true});
                })();
            } else {
                // If no cookies to set, send acknowledgment immediately
                sendResponse({success: true});
            }
        });

        return true; // Indicates we will send a response asynchronously
    }
    return true;
});


// Use the stored account data when a tab loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('chatgpt.com')) {
        // Retrieve the stored account data
        chrome.storage.local.get(['currentAccountData'], (result) => {
            if (result.currentAccountData) {
                // Execute script with the retrieved account data
                chrome.scripting.executeScript({
                    target: {tabId},
                    func: (accountData) => {
                        // You might want to stringify it if it's an object
                        localStorage.setItem('chatgptAccount', JSON.stringify(accountData));
                    },
                    args: [result.currentAccountData]
                });
            }
        });
    }
});


function getCookie(cookieString) {
    return {
        "domain": ".chatgpt.com",
        "expirationDate": Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        "httpOnly": true,
        "name": "__Secure-next-auth.session-token",
        "path": "/",
        "sameSite": "lax",
        "secure": true,
        "storeId": "0",
        "value": cookieString,
        "url": "https://chatgpt.com/"
    };
}
