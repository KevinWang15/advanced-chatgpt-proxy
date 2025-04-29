import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import {ReactKeycloakProvider} from '@react-keycloak/web';
import keycloak from './keycloak';

// Optional: Loading component while Keycloak is initializing
const LoadingComponent = () => <div>Loading Keycloak...</div>;

// Optional: Event logger
const handleKeycloakEvent = (event, error) => {
    console.log('Keycloak event:', event, error);
    if (event === 'onAuthSuccess') {
        console.log('Keycloak token:', keycloak.token);
    }
    if (event === 'onInitError') {
        console.error('Keycloak initialization error:', error);
    }
};

// Handle initialization errors
const onKeycloakError = (error) => {
    console.error('Failed to initialize Keycloak:', error);
};

ReactDOM.createRoot(document.getElementById('root')).render(
    <ReactKeycloakProvider
        authClient={keycloak}
        initOptions={{
            onLoad: 'check-sso',
            silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
            checkLoginIframe: true,
            checkLoginIframeInterval: 5,
            enableLogging: true,
            pkceMethod: 'S256'
        }}
        LoadingComponent={<LoadingComponent/>}
        onEvent={handleKeycloakEvent}
        onError={onKeycloakError}
    >
        <App/>
    </ReactKeycloakProvider>
);

