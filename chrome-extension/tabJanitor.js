// Tab Janitor - Manages ChatGPT tabs
class TabJanitor {
    constructor() {
        this.errorTabs = new Map(); // tabId -> timestamp
        this.nonChatGPTTabs = new Map(); // tabId -> timestamp
        this.chatGPTTabs = new Set();
        this.isActivating = false;
        this.MIN_CHATGPT_TABS = 6;
        this.ERROR_WAIT_TIME = 60000; // 10 seconds
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

    async categorizeTab(tab) {
        if (!tab.url) return;
        
        if (tab.url.includes('chatgpt.com')) {
            this.chatGPTTabs.add(tab.id);
            this.nonChatGPTTabs.delete(tab.id);
            
            // Check if it's in error state
            const isError = await this.isErrorPage(tab);
            if (isError) {
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

    // Check if a ChatGPT tab is in error state by looking for oaistatic resources or error messages
    async isErrorPage(tab) {
        // Only check ChatGPT tabs
        if (!tab.url || !tab.url.includes('chatgpt.com')) {
            return false;
        }
        
        try {
            // Check if the page contains oaistatic and doesn't have error messages
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    if (!document.body) return { hasOaistatic: false, hasError: true };
                    
                    const bodyText = document.body.innerText || '';
                    const hasOaistatic = document.body.innerHTML.indexOf('oaistatic') >= 0;
                    const hasContentError = bodyText.includes('Content failed to load');
                    
                    return { hasOaistatic, hasError: hasContentError };
                }
            });
            
            if (!results || !results[0] || !results[0].result) {
                return true; // Error state
            }
            
            const { hasOaistatic, hasError } = results[0].result;
            
            // It's an error page if:
            // 1. It has the "Content failed to load" message, OR
            // 2. It doesn't have oaistatic resources
            return hasError || !hasOaistatic;
        } catch (error) {
            // Script injection failed - tab is likely in an error state
            console.log(`Error checking tab ${tab.id}:`, error.message);
            return true;
        }
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
            
            // First, check all ChatGPT tabs to detect newly errored tabs
            for (const tabId of this.chatGPTTabs) {
                try {
                    const tab = await chrome.tabs.get(tabId);
                    const isError = await this.isErrorPage(tab);
                    
                    if (isError && !this.errorTabs.has(tabId)) {
                        // Newly detected error tab
                        this.errorTabs.set(tabId, Date.now());
                        console.log(`Detected new error tab: ${tabId}`);
                    } else if (!isError && this.errorTabs.has(tabId)) {
                        // Tab recovered from error state
                        this.errorTabs.delete(tabId);
                        console.log(`Tab recovered from error: ${tabId}`);
                    }
                } catch (e) {
                    // Tab doesn't exist anymore
                    this.chatGPTTabs.delete(tabId);
                    this.errorTabs.delete(tabId);
                }
            }
            
            // Then, check which error tabs should be closed
            for (const [tabId, timestamp] of this.errorTabs.entries()) {
                if (now - timestamp > this.ERROR_WAIT_TIME) {
                    try {
                        const tab = await chrome.tabs.get(tabId);
                        const isError = await this.isErrorPage(tab);
                        
                        if (isError) {
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