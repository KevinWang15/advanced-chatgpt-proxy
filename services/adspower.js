// AdsPower API Client
const axios = require('axios');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

class AdsPowerClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:50325';
    this.apiKey = options.apiKey || '';
    this.defaultTimeout = options.timeout || 30000; // 30 seconds default timeout
  }

  async createProfile(profileOptions = {}) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/user/create`, {
        api_key: this.apiKey,
        name: profileOptions.name || 'Default Profile',
        group_id: profileOptions.groupId || '',
        user_proxy_config: profileOptions.proxyConfig || null,
        fingerprint_config: {
          // Randomize fingerprint or use specific settings
          browser_kernel: 'chrome',
          ...profileOptions.fingerprintConfig
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error creating AdsPower profile:', error.message);
      throw new Error(`AdsPower profile creation failed: ${error.message}`);
    }
  }

  async openBrowser(userId, options = {}) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/browser/start`, {
        api_key: this.apiKey,
        user_id: userId,
        open_urls: options.urls || ['https://chatgpt.com'],
        ip_tab: options.ipTab || 0,
        launch_args: options.launchArgs || []
      });
      
      return response.data;
    } catch (error) {
      console.error('Error opening AdsPower browser:', error.message);
      throw new Error(`AdsPower browser open failed: ${error.message}`);
    }
  }

  async closeBrowser(userId) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/browser/stop`, {
        api_key: this.apiKey,
        user_id: userId
      });
      
      return response.data;
    } catch (error) {
      console.error('Error closing AdsPower browser:', error.message);
      throw new Error(`AdsPower browser close failed: ${error.message}`);
    }
  }

  async updateCookies(userId, cookies) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/v1/browser/cookies/update`, {
        api_key: this.apiKey,
        user_id: userId,
        cookies: cookies
      });
      
      return response.data;
    } catch (error) {
      console.error('Error updating AdsPower cookies:', error.message);
      throw new Error(`AdsPower cookie update failed: ${error.message}`);
    }
  }

  async listProfiles(groupId = '') {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/user/list`, {
        params: {
          api_key: this.apiKey,
          group_id: groupId
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error listing AdsPower profiles:', error.message);
      throw new Error(`AdsPower profile listing failed: ${error.message}`);
    }
  }

  // Helper to format cookies from string format to AdsPower format
  formatCookies(cookieString, domain = 'chatgpt.com') {
    try {
      const cookies = [];
      const parts = cookieString.split(/;\s*/);
      
      for (const part of parts) {
        const index = part.indexOf('=');
        if (index > -1) {
          const name = part.slice(0, index).trim();
          const value = part.slice(index + 1).trim();
          
          if (name) {
            cookies.push({
              name,
              value,
              domain,
              path: '/',
              expirationDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
              secure: name.startsWith('__Secure-'),
              httpOnly: name.startsWith('__Secure-')
            });
          }
        }
      }
      
      return cookies;
    } catch (error) {
      console.error('Error formatting cookies:', error);
      return [];
    }
  }
}

module.exports = AdsPowerClient;