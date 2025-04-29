import React from 'react';
import { useKeycloak } from '@react-keycloak/web';
import { Navigate } from 'react-router-dom';

function LoginPage() {
  const { keycloak, initialized } = useKeycloak();

  if (!initialized) {
    return <div>Loading...</div>;
  }

  // If user is already authenticated, redirect them away from login page (e.g., to profile)
  if (keycloak.authenticated) {
    return <Navigate to="/profile" />;
  }

  return (
    <div>
      <h2>Login Required</h2>
      <p>Please click the 'Login' button in the navigation bar to sign in or register.</p>
      <button onClick={() => keycloak.login()}>Login Now</button>
      {/* Optionally, add a button to go to Keycloak registration directly */}
      {/* <button onClick={() => keycloak.register()}>Register</button> */}
    </div>
  );
}

export default LoginPage;

