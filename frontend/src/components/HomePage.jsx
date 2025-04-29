import React from 'react';
import { useKeycloak } from '@react-keycloak/web';

function HomePage() {
  const { keycloak, initialized } = useKeycloak();

  return (
    <div>
      <h1>Welcome to the Membership Portal</h1>
      {initialized ? (
        keycloak.authenticated ? (
          <p>You are logged in as {keycloak.tokenParsed?.preferred_username}.</p>
        ) : (
          <p>Please log in to manage your membership.</p>
        )
      ) : (
        <p>Initializing Keycloak...</p>
      )}
    </div>
  );
}

export default HomePage;

