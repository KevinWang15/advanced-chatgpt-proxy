// AdsPower API Client
const axios = require('axios');
const os = require('os');

function getUaSystemVersionByRealOS() {
    const platform = os.platform();

    if (platform === 'win32') {
        return 'Windows 10';
    } else if (platform === 'darwin') {
        return 'Mac OS X 13';
    } else if (platform === 'linux') {
        return 'Linux';
    } else {
        return `Linux`;
    }
}

class AdsPowerClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'http://localhost:50325';
        this.apiKey = options.apiKey || '';
        this.defaultTimeout = options.timeout || 30000; // 30 seconds default timeout
    }

    async createProfile(profileOptions = {}) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/create`, {
                api_key: this.apiKey,
                name: profileOptions.name || 'Default Profile',
                group_id: profileOptions.groupId || '',
                user_proxy_config: profileOptions.proxyConfig || null,
                fingerprint_config: {
                    language: ["en-US", "en"],
                    random_ua: {
                        ua_browser: ["chrome"],
                        ua_system_version:[getUaSystemVersionByRealOS()]
                    },
                    ...profileOptions.fingerprintConfig
                }
            });

            return response.data;
        } catch (error) {
            console.error('Error creating AdsPower profile:', error.message);
            throw new Error(`AdsPower profile creation failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }

    async openBrowser(profile_id) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/start`, {
                last_opened_tabs: 0,
                api_key: this.apiKey,
                profile_id,
            });
            return response.data;
        } catch (error) {
            console.error('Error opening AdsPower browser:', error.message);
            throw new Error(`AdsPower browser open failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }

    async closeBrowser(profile_id) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/stop`, {
                api_key: this.apiKey,
                profile_id
            });

            return response.data;
        } catch (error) {
            console.error('Error closing AdsPower browser:', error.message);
            throw new Error(`AdsPower browser close failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }

    async deleteBrowser(profile_id) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/delete`, {
                api_key: this.apiKey,
                profile_id: [profile_id],
            });

            return response.data;
        } catch (error) {
            console.error('Error deleting AdsPower browser:', error.message);
            throw new Error(`AdsPower browser delete failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }

    async listProfiles(groupId = '') {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/list`, {
                api_key: this.apiKey,
                group_id: groupId,
                limit: 1000
            });

            return response.data;
        } catch (error) {
            console.error('Error listing AdsPower profiles:', error.message);
            throw new Error(`AdsPower profile listing failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }


    async updateProfile(updateOptions = {}) {
        try {
            const response = await axios.post(`${this.baseUrl}/api/v2/browser-profile/update`, {
                api_key: this.apiKey,
                ...updateOptions
            });
            return response.data;
        } catch (error) {
            console.error('[AdsPower] Error updating profile:', error.message);
            throw new Error(`AdsPower profile update failed: ${error.message}`);
        } finally {
            await sleep(1200);
        }
    }

}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = AdsPowerClient;