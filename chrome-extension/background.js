// Import TabJanitor
import TabJanitor from './tabJanitor.js';

let tabJanitor = null;

// Initialize TabJanitor when extension starts
chrome.runtime.onInstalled.addListener(() => {
    console.log('ChatGPT Proxy Extension installed/updated');
});

// Also initialize on startup in case extension was already installed
chrome.runtime.onStartup.addListener(() => {
    console.log('ChatGPT Proxy Extension started');
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_CHATGPT_TAB_JANITOR') {
        if (!tabJanitor) {
            tabJanitor = new TabJanitor();
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


// Listen for cookie changes to capture session token updates
chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.cookie.name === '__Secure-next-auth.session-token' &&
        changeInfo.cookie.domain === '.chatgpt.com' &&
        !changeInfo.removed) {

        const newSessionToken = changeInfo.cookie.value;
        console.log('Captured cookie update from onChanged:', newSessionToken);

        // Update the stored account data with new session token
        chrome.storage.local.get(['currentAccountData'], (result) => {
            if (result.currentAccountData && result.currentAccountData.cookie !== newSessionToken) {
                const updatedAccountData = {
                    ...result.currentAccountData,
                    cookie: newSessionToken
                };

                chrome.storage.local.set({currentAccountData: updatedAccountData}, () => {
                    console.log('Account data updated with new session token from cookie change');
                });

                // Send PUT request to cdn.oaistatic.com/cookies
                fetch('https://cdn.oaistatic.com/cookies', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        sessionToken: newSessionToken,
                    })
                }).then(response => {
                    console.log('Cookie update sent to cdn.oaistatic.com:', response.status);
                }).catch(error => {
                    console.error('Failed to send cookie update:', error);
                });
            }
        });
    }
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
