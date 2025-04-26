const express = require('express');
const router = express.Router();
const path = require('path');
const configManager = require('../middleware/configManager');
const {restartBrowser, deleteBrowser} = require("../../services/launch_browser");

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'accounts.html'));
});

// API endpoint to get all accounts
router.get('/api/list', (req, res) => {
    const accounts = configManager.getAllAccounts();
    res.json(accounts);
});

// API endpoint to get a single account
router.get('/api/:name', (req, res) => {
    const account = configManager.getAccountByName(req.params.name);
    if (account) {
        res.json(account);
    } else {
        res.status(404).json({error: 'Account not found'});
    }
});

// API endpoint to add a new account
router.post('/api/add', (req, res) => {
    const result = configManager.addAccount(req.body);
    if (result.success) {
        res.json(result);
    } else {
        res.status(400).json(result);
    }
});

// API endpoint to update an account
router.put('/api/:name', (req, res) => {
    const result = configManager.updateAccount(req.params.name, req.body);
    if (result.success) {
        res.json(result);
    } else {
        res.status(400).json(result);
    }
});

// API endpoint to delete an account
router.delete('/api/:name', (req, res) => {
    const result = configManager.deleteAccount(req.params.name);
    if (result.success) {
        res.json(result);
    } else {
        res.status(404).json(result);
    }
});

// API endpoint to restart browser for an account
router.post('/api/restart-browser/:name', async (req, res) => {
    const accountName = req.params.name;
    const account = configManager.getAccountByName(accountName);

    if (!account) {
        return res.status(404).json({success: false, message: 'Account not found'});
    }

    try {
        // Call the restartBrowser function (console.log for now)
        console.log(`Restarting browser for account: ${accountName}`);
        setTimeout(async () => {
            try {
                await restartBrowser(account);
            } catch (e) {
                console.error(`Error restarting browser for ${accountName}:`, e);
            }
        })

        res.json({success: true});
    } catch (error) {
        console.error(`Error restarting browser for ${accountName}:`, error);
        res.status(500).json({success: false, message: 'Failed to restart browser'});
    }
});

// API endpoint to delete browser for an account
router.post('/api/delete-browser/:name', async (req, res) => {
    const accountName = req.params.name;
    const account = configManager.getAccountByName(accountName);

    if (!account) {
        return res.status(404).json({success: false, message: 'Account not found'});
    }

    try {
        // Call the deleteBrowser function (console.log for now)
        console.log(`Restarting browser for account: ${accountName}`);
        deleteBrowser(account);

        // Return success response
        res.json({success: true});
    } catch (error) {
        console.error(`Error deleting browser for ${accountName}:`, error);
        res.status(500).json({success: false, message: 'Failed to delete browser'});
    }
});

// API endpoint to extract data from cookies
router.post('/api/extract-cookies', (req, res) => {
    const {cookies, proxy} = req.body;

    if (!cookies) {
        return res.status(400).json({success: false, message: 'Cookies are required'});
    }

    if (!proxy) {
        return res.status(400).json({success: false, message: 'Proxy is required'});
    }

    // Call ChatGPT API with cookies and proxy
    fetchChatGPTSession(cookies, proxy)
        .then(data => {
            if (data && data.user) {
                // Extract and format the data
                const extractedData = {
                    name: data.user.email,
                    accessToken: data.accessToken || '',
                    plan: (data.account && data.account.planType) || ''
                };
                res.json(extractedData);
            } else {
                res.status(400).json({success: false, message: 'Invalid response from API'});
            }
        })
        .catch(error => {
            console.error('Error fetching session data:', error);
            res.status(500).json({success: false, message: 'Failed to fetch data from API'});
        });
});

// Function to fetch session data from ChatGPT API using cookies and proxy
async function fetchChatGPTSession(cookieString, proxyUrl) {
    const https = require('https');
    const {HttpsProxyAgent} = require('https-proxy-agent');
    const url = require('url');

    // Create proxy agent
    const agent = new HttpsProxyAgent(proxyUrl);

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'chatgpt.com',
            path: '/api/auth/session',
            method: 'GET',
            headers: {
                'origin': 'https://chatgpt.com',
                'cookie': '__Secure-next-auth.session-token=' + cookieString,
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
            },
            agent: agent
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    resolve(parsedData);
                } catch (error) {
                    reject(new Error('Failed to parse API response'));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

module.exports = router;
