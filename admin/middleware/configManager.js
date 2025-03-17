/**
 * Config Manager - Handles reading and writing to config.js
 */
const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, "..", "..", process.env.CONFIG);

// Get the current configuration
const getConfig = () => {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
};

// Save the configuration
const saveConfig = (config) => {
    const configString = `module.exports = ${JSON.stringify(config, null, 2)};`;
    fs.writeFileSync(configPath, configString, 'utf8');
};

// Get all accounts
const getAllAccounts = () => {
    const config = getConfig();
    return config.accounts || [];
};

// Get a single account by name
const getAccountByName = (name) => {
    const accounts = getAllAccounts();
    return accounts.find(account => account.name === name);
};

// Add a new account
const addAccount = (accountData) => {
    const config = getConfig();

    // Check if account with this name already exists
    const existingIndex = config.accounts.findIndex(a => a.name === accountData.name);

    if (existingIndex >= 0) {
        return {success: false, message: 'Account with this name already exists'};
    }

    // Ensure labels has the correct structure
    if (!accountData.labels) {
        accountData.labels = {plan: "plus"};
    } else if (!accountData.labels.plan) {
        accountData.labels.plan = "plus";
    }

    config.accounts.push(accountData);
    saveConfig(config);

    return {success: true, message: 'Account added successfully'};
};

// Update an existing account
const updateAccount = (name, accountData) => {
    const config = getConfig();
    const index = config.accounts.findIndex(a => a.name === name);

    if (index === -1) {
        return {success: false, message: 'Account not found'};
    }

    // Ensure labels has the correct structure
    if (!accountData.labels) {
        accountData.labels = {plan: "plus"};
    } else if (!accountData.labels.plan) {
        accountData.labels.plan = "plus";
    }

    // Update the account
    config.accounts[index] = accountData;
    saveConfig(config);

    return {success: true, message: 'Account updated successfully'};
};

// Delete an account
const deleteAccount = (name) => {
    const config = getConfig();
    const initialLength = config.accounts.length;

    config.accounts = config.accounts.filter(a => a.name !== name);

    if (config.accounts.length === initialLength) {
        return {success: false, message: 'Account not found'};
    }

    saveConfig(config);
    return {success: true, message: 'Account deleted successfully'};
};


module.exports = {
    getConfig,
    saveConfig,
    getAllAccounts,
    getAccountByName,
    addAccount,
    updateAccount,
    deleteAccount,
};
