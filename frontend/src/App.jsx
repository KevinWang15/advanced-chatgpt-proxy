import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link, Navigate } from 'react-router-dom';
import { useKeycloak } from '@react-keycloak/web';

// Import Components (to be created)
import HomePage from './components/HomePage';
import ProfilePage from './components/ProfilePage';
import MembershipPage from './components/MembershipPage';
import LoginPage from './components/LoginPage'; // A simple page to guide login

// Higher-Order Component for protected routes
function PrivateRoute({ children }) {
  const { keycloak, initialized } = useKeycloak();

  if (!initialized) {
    return <div>Loading...</div>; // Or your loading component
  }

  const isLoggedIn = keycloak.authenticated;

  return isLoggedIn ? children : <Navigate to="/login" />;
}

function App() {
  const { keycloak, initialized } = useKeycloak();

  if (!initialized) {
    return <div>Loading Application...</div>;
  }

  return (
    <Router>
      <div>
        <nav style={{ padding: '1rem', background: '#eee', marginBottom: '1rem' }}>
          <Link to="/" style={{ marginRight: '1rem' }}>Home</Link>
          {keycloak.authenticated && (
            <>
              <Link to="/profile" style={{ marginRight: '1rem' }}>Profile</Link>
              <Link to="/membership" style={{ marginRight: '1rem' }}>Membership</Link>
            </>
          )}
          <span style={{ float: 'right' }}>
            {!keycloak.authenticated ? (
              <button onClick={() => keycloak.login()}>Login</button>
            ) : (
              <button onClick={() => keycloak.logout()}>Logout ({keycloak.tokenParsed?.preferred_username})</button>
            )}
          </span>
        </nav>

        <div style={{ padding: '1rem' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/profile"
              element={<PrivateRoute><ProfilePage /></PrivateRoute>}
            />
            <Route
              path="/membership"
              element={<PrivateRoute><MembershipPage /></PrivateRoute>}
            />
            {/* Add other routes as needed */}
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;

