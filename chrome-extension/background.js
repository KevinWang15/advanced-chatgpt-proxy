chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SETUP_EXTENSION') {
        const {accountData} = message;

        // Save account data to Chrome storage
        chrome.storage.local.set({currentAccountData: accountData}, () => {
            console.log('Account data saved');

            if (accountData.cookie) {
                const cookiesArray = getCookies(accountData.cookie);

                (async function setCookies() {
                    for (const c of cookiesArray) {
                        await chrome.cookies.set(c);
                    }
                    // Send acknowledgment back to content.js
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

const MASTER_COOKIES = [
    {
        name: '__Secure-next-auth.callback-url',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.0',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.1',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: '__Secure-next-auth.session-token.2',
        domain: 'chatgpt.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
    },
    {
        name: 'oai-did',
        domain: 'chatgpt.com',
        path: '/',
    },
    {
        name: 'oai-locale',
        domain: 'chatgpt.com',
        path: '/',
    },
    {
        name: 'oai-gn',
        domain: 'chatgpt.com',
        path: '/',
    },
    {
        name: 'oai-hlib',
        domain: 'chatgpt.com',
        path: '/',
    },
];

function parseCookies(cookieString) {
    const cookieMap = {};
    const parts = cookieString.split(/;\s*/);
    for (const part of parts) {
        const index = part.indexOf('=');
        if (index > -1) {
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (name) {
                cookieMap[name] = value;
            }
        }
    }
    return cookieMap;
}

function getCookies(cookieString) {
    const parsedInput = parseCookies(cookieString);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const oneMonthSeconds = 30 * 24 * 60 * 60; // ~30 days
    const expirationTime = nowSeconds + oneMonthSeconds;

    const cookies = MASTER_COOKIES
        .filter(template => parsedInput[template.name]) // only those that exist in user input
        .map(template => {
            if (template.name === 'oai-locale') {
                return null;
            }
            return {
                name: template.name,
                domain: template.domain,
                path: template.path,
                secure: !!template.secure,
                httpOnly: !!template.httpOnly,
                sameSite: template.sameSite || 'lax',

                // For MV3 `chrome.cookies.set()`, you'll want fields like this:
                url: `https://${template.domain}${template.path}`,
                value: parsedInput[template.name],
                expirationDate: expirationTime
            };
        })
        .filter(x => x);

    cookies.push({
        name: 'oai-locale',
        domain: 'chatgpt.com',
        url: `https://chatgpt.com/`,
        path: "/",
        secure: true,
        value: "en-US",
        expirationDate: expirationTime
    })

    return cookies;
}
