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
          language: ["en-US","en"],
          random_ua: {"ua_browser": ["chrome"], ua_system_version: ["Mac OS X 13"]},
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
        const response = await axios.get(`${this.baseUrl}/api/v1/browser/start`, {
            params: {
                api_key: this.apiKey,
                user_id: userId,
                launch_args: options.launchArgs || []
            }
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
          group_id: groupId,
          page_size: 1000
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error listing AdsPower profiles:', error.message);
      throw new Error(`AdsPower profile listing failed: ${error.message}`);
    }
  }
}

module.exports = AdsPowerClient;