const {logger} = require('../utils/utils');
const config = require('../config');
const fs = require("node:fs");

function handleSubscriptions(req, res) {
    const subscriptionData = {
        id: "00000000-0000-0000-0000-000000000000",
        plan_type: 'pro',
        seats_in_use: 1,
        seats_entitled: 1,
        active_until: '2050-01-01T00:00:00Z',
        will_renew: true,
        billing_currency: 'USD',
        is_delinquent: false,
    };

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': config.server.url,
        'access-control-allow-credentials': 'true',
    });

    res.end(JSON.stringify(subscriptionData));
}

function handleChatRequirements(req, res) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': config.server.url,
        'access-control-allow-credentials': 'true',
    });

    res.end(JSON.stringify({
        "persona": "chatgpt-paid",
        "turnstile": {
            "required": false
        },
        "proofofwork": {
            "required": false
        }
    }));
}

function handleRobotsTxt(req, res) {
    logger.info('Serving robots.txt to ban all crawlers');
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('User-agent: *\nDisallow: /');
}

function handleGetModels(req, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(fs.readFileSync('static/models.json'));
}

function handleBackendApiMe(req, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(
        JSON.stringify({
                "object": "user",
                "id": "user-IJUO9QR211ec8vd0DVl00000",
                "email": "sama@openai.com",
                "name": "S",
                "picture": null,
                "created": 1730643048,
                "phone_number": null,
                "mfa_flag_enabled": true,
                "amr": [],
                "groups": [],
                "orgs": {
                    "object": "list",
                    "data": [
                        {
                            "object": "organization",
                            "id": "org-5GyFJAkpPCzFDFDpEzv00000",
                            "created": 1730643048,
                            "title": "Personal",
                            "name": "user-ijuo9qr211ec8vd0dvl00000",
                            "description": "Personal org for sama@openai.com",
                            "personal": true,
                            "settings": {
                                "threads_ui_visibility": "NONE",
                                "usage_dashboard_visibility": "ANY_ROLE",
                                "disable_user_api_keys": false,
                                "completed_platform_onboarding": false
                            },
                            "parent_org_id": null,
                            "is_default": true,
                            "role": "owner",
                            "is_scale_tier_authorized_purchaser": false,
                            "is_scim_managed": false,
                            "projects": {
                                "object": "list",
                                "data": []
                            },
                            "groups": [],
                            "geography": null
                        }
                    ]
                },
                "has_payg_project_spend_limit": true
            }
        )
    );
}

function handleBackendApiCreatorProfile(req, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(
        JSON.stringify({
            "name": "Sam Altman",
            "display_name": "Sam Altman",
            "hide_name": false,
            "website_url": "https://openai.com",
            "socials": {
                "linkedin": {
                    "id": "linkedinverify-4b97-9080-6c959845166a",
                    "type": "linkedin",
                    "display_name": "LinkedIn",
                    "verified": false,
                    "verified_data": {}
                },
                "twitter": {
                    "id": "twitterverify-43d2-b12a-bbe33d600487",
                    "type": "twitter",
                    "display_name": "X",
                    "verified": false,
                    "verified_data": {}
                },
                "instagram": {
                    "id": "instagramverify-4188-b980-7318dcd3fa1d",
                    "type": "instagram",
                    "display_name": "Instagram",
                    "verified": false,
                    "verified_data": {}
                },
                "github": {
                    "id": "githubverify-dff6-4871-860f-d61dfa7afa7f",
                    "type": "github",
                    "display_name": "GitHub",
                    "verified": false,
                    "verified_data": {}
                }
            },
            "domains": [],
            "is_verified": true,
            "will_receive_support_emails": null
        })
    );
}

const StopGenerationCallback = {};

function handleStopGeneration(conversationId, res) {
    if (StopGenerationCallback[conversationId]) {
        StopGenerationCallback[conversationId]();
        delete StopGenerationCallback[conversationId];
    }

    if (!res.headersSent) {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({}));
    }
}

module.exports = {
    handleSubscriptions,
    handleRobotsTxt,
    handleGetModels,
    handleBackendApiMe,
    handleBackendApiCreatorProfile,
    handleChatRequirements,
    handleStopGeneration,
    StopGenerationCallback
};

