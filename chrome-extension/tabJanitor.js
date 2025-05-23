// Tab Janitor - Manages ChatGPT tabs
class TabJanitor {
    constructor() {
        this.errorTabs = new Map(); // tabId -> timestamp
        this.nonChatGPTTabs = new Map(); // tabId -> timestamp
        this.chatGPTTabs = new Set();
        this.isActivating = false;
        this.MIN_CHATGPT_TABS = 6;
        this.ERROR_WAIT_TIME = 10000; // 10 seconds
        this.NON_CHATGPT_MAX_AGE = 60000; // 1 minute
        
        this.init();
    }

    async init() {
        // Get all existing tabs on startup
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => this.categorizeTab(tab));
        
        // Start monitoring loops
        this.startErrorTabMonitoring();
        this.startNonChatGPTTabMonitoring();
        this.startChatGPTTabMaintenance();
        this.startTabActivation();
        
        // Listen for tab updates
        chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
        chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
        chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
    }

    categorizeTab(tab) {
        if (!tab.url) return;
        
        if (tab.url.includes('chatgpt.com')) {
            this.chatGPTTabs.add(tab.id);
            this.nonChatGPTTabs.delete(tab.id);
            
            // Check if it's in error state
            if (this.isErrorPage(tab)) {
                this.errorTabs.set(tab.id, Date.now());
            } else {
                this.errorTabs.delete(tab.id);
            }
        } else {
            this.nonChatGPTTabs.set(tab.id, Date.now());
            this.chatGPTTabs.delete(tab.id);
            this.errorTabs.delete(tab.id);
        }
    }

    isErrorPage(tab) {
        // Check for Chrome error pages
        const errorUrls = [
            'chrome-error://',
            'data:text/html,chromewebdata',
            'about:blank'
        ];
        
        if (errorUrls.some(errorUrl => tab.url.startsWith(errorUrl))) {
            return true;
        }
        
        // Check title for common error messages
        const errorTitles = [
            'This site can't be reached',
            'No internet',
            'Aw, Snap!',
            'He's Dead, Jim!',
            'Something went wrong',
            'Error loading page'
        ];
        
        if (tab.title && errorTitles.some(errorTitle => 
            tab.title.toLowerCase().includes(errorTitle.toLowerCase()))) {
            return true;
        }
        
        return false;
    }

    async handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' || changeInfo.url) {
            this.categorizeTab(tab);
        }
    }

    handleTabRemoved(tabId) {
        this.chatGPTTabs.delete(tabId);
        this.nonChatGPTTabs.delete(tabId);
        this.errorTabs.delete(tabId);
    }

    handleTabCreated(tab) {
        this.categorizeTab(tab);
    }

    // Monitor error tabs and close them after 10 seconds
    startErrorTabMonitoring() {
        setInterval(async () => {
            const now = Date.now();
            const tabsToClose = [];
            
            for (const [tabId, timestamp] of this.errorTabs.entries()) {
                if (now - timestamp > this.ERROR_WAIT_TIME) {
                    try {
                        const tab = await chrome.tabs.get(tabId);
                        if (this.isErrorPage(tab)) {
                            tabsToClose.push(tabId);
                        } else {
                            // Tab recovered, remove from error tracking
                            this.errorTabs.delete(tabId);
                        }
                    } catch (e) {
                        // Tab doesn't exist anymore
                        this.errorTabs.delete(tabId);
                    }
                }
            }
            
            // Close error tabs
            for (const tabId of tabsToClose) {
                try {
                    await chrome.tabs.remove(tabId);
                    console.log(`Closed error tab: ${tabId}`);
                } catch (e) {
                    console.error(`Failed to close tab ${tabId}:`, e);
                }
            }
        }, 5000); // Check every 5 seconds
    }

    // Monitor non-ChatGPT tabs and close them after 1 minute
    startNonChatGPTTabMonitoring() {
        setInterval(async () => {
            const now = Date.now();
            const tabsToClose = [];
            
            for (const [tabId, timestamp] of this.nonChatGPTTabs.entries()) {
                if (now - timestamp > this.NON_CHATGPT_MAX_AGE) {
                    tabsToClose.push(tabId);
                }
            }
            
            // Close old non-ChatGPT tabs
            for (const tabId of tabsToClose) {
                try {
                    await chrome.tabs.remove(tabId);
                    console.log(`Closed non-ChatGPT tab: ${tabId}`);
                } catch (e) {
                    console.error(`Failed to close tab ${tabId}:`, e);
                }
            }
        }, 10000); // Check every 10 seconds
    }

    // Maintain minimum number of ChatGPT tabs
    startChatGPTTabMaintenance() {
        setInterval(async () => {
            // Clean up closed tabs from our set
            const allTabs = await chrome.tabs.query({});
            const existingTabIds = new Set(allTabs.map(tab => tab.id));
            
            // Remove tabs that no longer exist
            for (const tabId of this.chatGPTTabs) {
                if (!existingTabIds.has(tabId)) {
                    this.chatGPTTabs.delete(tabId);
                }
            }
            
            // Count healthy ChatGPT tabs (not in error state)
            let healthyChatGPTTabCount = 0;
            for (const tabId of this.chatGPTTabs) {
                if (!this.errorTabs.has(tabId)) {
                    healthyChatGPTTabCount++;
                }
            }
            
            // Open new tabs if needed
            const tabsToOpen = this.MIN_CHATGPT_TABS - healthyChatGPTTabCount;
            if (tabsToOpen > 0) {
                console.log(`Opening ${tabsToOpen} new ChatGPT tabs`);
                for (let i = 0; i < tabsToOpen; i++) {
                    try {
                        const tab = await chrome.tabs.create({ 
                            url: 'https://chatgpt.com/',
                            active: false
                        });
                        this.chatGPTTabs.add(tab.id);
                    } catch (e) {
                        console.error('Failed to create ChatGPT tab:', e);
                    }
                }
            }
        }, 15000); // Check every 15 seconds
    }

    // Activate tabs randomly
    startTabActivation() {
        const scheduleNextActivation = () => {
            // Random delay between 0-60 seconds
            const delay = Math.random() * 60000;
            
            setTimeout(async () => {
                if (!this.isActivating) {
                    await this.activateTabsSequentially();
                }
                scheduleNextActivation();
            }, delay);
        };
        
        scheduleNextActivation();
    }

    async activateTabsSequentially() {
        this.isActivating = true;
        
        try {
            // Get all ChatGPT tabs in order
            const tabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
            
            console.log(`Starting tab activation cycle for ${tabs.length} tabs`);
            
            for (const tab of tabs) {
                try {
                    // Activate the tab
                    await chrome.tabs.update(tab.id, { active: true });
                    
                    // Focus the window containing the tab
                    if (tab.windowId) {
                        await chrome.windows.update(tab.windowId, { focused: true });
                    }
                    
                    // Random pause between 1-5 seconds
                    const pauseTime = 1000 + Math.random() * 4000;
                    await new Promise(resolve => setTimeout(resolve, pauseTime));
                    
                } catch (e) {
                    console.error(`Failed to activate tab ${tab.id}:`, e);
                }
            }
            
            console.log('Tab activation cycle completed');
        } catch (e) {
            console.error('Error during tab activation:', e);
        } finally {
            this.isActivating = false;
        }
    }
}

// Export for use in background.js
export default TabJanitor;