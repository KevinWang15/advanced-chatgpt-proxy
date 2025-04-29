import Keycloak from 'keycloak-js';

// Use environment variables or a configuration file for these values
const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_AUTH_URL || 'http://localhost:8080/auth',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'myrealm',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'myclient',
};

// Try to connect without iframe checks
const keycloak = new Keycloak(keycloakConfig);

// Add initialization error handling
keycloak.onInitError = (error) => {
  console.error('Keycloak initialization error:', error);
};

export default keycloak;

