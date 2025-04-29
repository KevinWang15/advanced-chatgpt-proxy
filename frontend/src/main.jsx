import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { ReactKeycloakProvider } from '@react-keycloak/web';
import keycloak from './keycloak';

// Optional: Loading component while Keycloak is initializing
const LoadingComponent = () => <div>Loading Keycloak...</div>;

// Optional: Event logger
const handleKeycloakEvent = (event, error) => {
  console.log('Keycloak event:', event, error);
  if (event === 'onAuthSuccess') {
    console.log('Keycloak token:', keycloak.token);
  }
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ReactKeycloakProvider
      authClient={keycloak}
      initOptions={{ onLoad: 'check-sso', silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html' }}
      LoadingComponent={<LoadingComponent />}
      onEvent={handleKeycloakEvent}
    >
      <App />
    </ReactKeycloakProvider>
  </React.StrictMode>,
);

