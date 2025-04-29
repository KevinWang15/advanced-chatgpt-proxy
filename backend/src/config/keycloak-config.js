const session = require("express-session");
const Keycloak = require("keycloak-connect");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const memoryStore = new session.MemoryStore();

const keycloakConfig = {
  clientId: process.env.KEYCLOAK_CLIENT_ID || "myclient",
  bearerOnly: false, // Set to true if only validating tokens, false for login flows
  serverUrl: process.env.KEYCLOAK_AUTH_SERVER_URL || "http://localhost:8080",
  realm: process.env.KEYCLOAK_REALM || "myrealm",
  credentials: {
    secret: process.env.KEYCLOAK_CLIENT_SECRET || "myclientsecret",
  },
  "public-client": false, // Set to true for public clients (like SPAs)
  "use-resource-role-mappings": true, // Use resource roles if needed
  "confidential-port": 0, // Not typically needed with reverse proxies
  "ssl-required": "external", // Adjust based on your Keycloak setup (none, external, all)
};

// Initialize Keycloak middleware
// The store parameter is crucial for session management
const keycloak = new Keycloak({ store: memoryStore }, keycloakConfig);

console.log("Keycloak configuration initialized:");
console.log(` Realm: ${keycloakConfig.realm}`);
console.log(` Auth Server URL: ${keycloakConfig.serverUrl}`);
console.log(` Client ID: ${keycloakConfig.clientId}`);

module.exports = {
  keycloak,
  memoryStore, // Export store if needed elsewhere, e.g., in app.js for session setup
};

