module.exports = {
    domainsToProxy: [
        'cdn.oaistatic.com',
        'ab.chatgpt.com',
        'chatgpt.com',
    ],
    mockSuccessDomains: ['ab.chatgpt.com'],
    mockSuccessPaths: ['/ces/'],
    bannedPaths: [
        "backend-api/accounts/logout_all",
        "backend-api/accounts/deactivate",
        "backend-api/payments",
        "backend-api/settings/clear_account_user_memory",
        "backend-api/accounts/mfa_info",
        "backend-api/accounts/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/invites",
        "admin",
    ],
}