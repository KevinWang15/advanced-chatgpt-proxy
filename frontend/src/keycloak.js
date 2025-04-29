import Keycloak from 'keycloak-js';

// Use environment variables or a configuration file for these values
const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_AUTH_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'myrealm',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'myclient',
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;

