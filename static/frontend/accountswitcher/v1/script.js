// Constants
const ENDPOINTS = {
    ACCOUNTS: '/accounts',
    METRICS: '/metrics',
    SWITCH_ACCOUNT: '/switch-account/'
};

// State management
let accounts = [];
let currentAccountName = '';
let degradationData = {};

// DOM Elements
const currentAccountNameEl = document.getElementById('current-account-name');
const currentAccountBadgeEl = document.getElementById('current-account-badge');
const accountsListEl = document.getElementById('accounts-list');
const statusMessageEl = document.getElementById('status-message');
const accountTemplate = document.getElementById('account-template');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await Promise.all([
            fetchAccounts(),
            getCurrentAccount(),
            fetchDegradationMetrics()
        ]);
        
        renderAccounts();
        updateCurrentAccountDisplay();
    } catch (error) {
        showStatus('Failed to initialize: ' + error.message, 'error');
    }
});

// Fetch accounts from the API
async function fetchAccounts() {
    try {
        const response = await fetch(ENDPOINTS.ACCOUNTS);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        accounts = await response.json();
        return accounts;
    } catch (error) {
        showStatus('Failed to fetch accounts: ' + error.message, 'error');
        throw error;
    }
}

// Get current account from cookie
function getCurrentAccount() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'account_name') {
            currentAccountName = decodeURIComponent(value);
            return currentAccountName;
        }
    }
    showStatus('No current account found in cookies', 'warning');
    return null;
}

// Fetch degradation metrics
async function fetchDegradationMetrics() {
    try {
        const response = await fetch(ENDPOINTS.METRICS);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const metricsText = await response.text();
        parseDegradationMetrics(metricsText);
        return degradationData;
    } catch (error) {
        showStatus('Failed to fetch degradation metrics: ' + error.message, 'warning');
        // Continue without degradation data
        return {};
    }
}

// Parse degradation metrics from Prometheus format
function parseDegradationMetrics(metricsText) {
    const lines = metricsText.split('\n');
    for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || line.trim() === '') {
            continue;
        }
        
        // Parse metrics line
        if (line.startsWith('chatgpt_degradation{')) {
            const match = line.match(/chatgpt_degradation{account_name="([^"]+)".*} (\d+)/);
            if (match) {
                const accountName = match[1];
                const degradationLevel = parseInt(match[2], 10);
                degradationData[accountName] = degradationLevel;
            }
        }
    }
}

// Render accounts list
function renderAccounts() {
    // Clear loading message
    accountsListEl.innerHTML = '';
    
    accounts.forEach(account => {
        const accountElement = createAccountElement(account);
        accountsListEl.appendChild(accountElement);
    });
}

// Create account element from template
function createAccountElement(account) {
    const template = accountTemplate.content.cloneNode(true);
    const accountItem = template.querySelector('.account-item');
    
    // Set account name
    const accountNameEl = accountItem.querySelector('.account-name');
    accountNameEl.textContent = account.name;
    
    // Set plan badge
    const planBadgeEl = accountItem.querySelector('.plan-badge');
    if (account.labels && account.labels.plan) {
        planBadgeEl.textContent = account.labels.plan;
        planBadgeEl.classList.add(account.labels.plan.toLowerCase());
    } else {
        planBadgeEl.textContent = 'free';
        planBadgeEl.classList.add('free');
    }
    
    // Set degradation badge
    const degradationBadgeEl = accountItem.querySelector('.degradation-badge');
    const degradationLevel = degradationData[account.name];
    
    if (degradationLevel !== undefined) {
        switch (degradationLevel) {
            case 0:
                degradationBadgeEl.textContent = 'OK';
                degradationBadgeEl.classList.add('none');
                break;
            case 1:
                degradationBadgeEl.textContent = 'Degraded';
                degradationBadgeEl.classList.add('slight');
                break;
            case 2:
                degradationBadgeEl.textContent = 'Severe';
                degradationBadgeEl.classList.add('severe');
                break;
            default:
                degradationBadgeEl.textContent = 'Unknown';
                degradationBadgeEl.classList.add('unknown');
        }
    } else {
        degradationBadgeEl.textContent = 'Unknown';
        degradationBadgeEl.classList.add('unknown');
    }
    
    // Set switch button
    const switchButton = accountItem.querySelector('.switch-button');
    
    // Disable switch button for current account
    if (account.name === currentAccountName) {
        accountItem.classList.add('current');
        switchButton.disabled = true;
        switchButton.textContent = 'Current';
    }
    
    switchButton.addEventListener('click', () => switchAccount(account.name));
    
    return accountItem;
}

// Update current account display
function updateCurrentAccountDisplay() {
    if (!currentAccountName) {
        currentAccountNameEl.textContent = 'No account selected (defaults to the first one)';
        return;
    }
    
    currentAccountNameEl.textContent = currentAccountName;
    
    // Find current account in accounts list
    const currentAccount = accounts.find(account => account.name === currentAccountName);
    if (currentAccount && currentAccount.labels && currentAccount.labels.plan) {
        currentAccountBadgeEl.textContent = currentAccount.labels.plan;
        currentAccountBadgeEl.className = 'badge plan-badge ' + currentAccount.labels.plan.toLowerCase();
    } else {
        currentAccountBadgeEl.textContent = 'free';
        currentAccountBadgeEl.className = 'badge plan-badge free';
    }
}

// Switch to a different account
async function switchAccount(accountName) {
    try {
        showStatus('Switching account...', 'warning');
        
        const response = await fetch(ENDPOINTS.SWITCH_ACCOUNT + encodeURIComponent(accountName));
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        // Update current account
        currentAccountName = accountName;

        // Update UI
        updateCurrentAccountDisplay();
        renderAccounts();
        
        showStatus(`Switched to account: ${accountName}`, 'success');
    } catch (error) {
        showStatus('Failed to switch account: ' + error.message, 'error');
    }
}

// Show status message
function showStatus(message, type = 'info') {
    statusMessageEl.textContent = message;
    statusMessageEl.className = 'status-message ' + type;
    
    // Clear status message after 5 seconds
    setTimeout(() => {
        statusMessageEl.textContent = '';
        statusMessageEl.className = 'status-message';
    }, 5000);
}

// Refresh data periodically (every 30 seconds)
setInterval(async () => {
    try {
        await Promise.all([
            fetchAccounts(),
            getCurrentAccount(),
            fetchDegradationMetrics()
        ]);
        
        renderAccounts();
        updateCurrentAccountDisplay();
    } catch (error) {
        console.error('Error refreshing data:', error);
    }
}, 30000);
