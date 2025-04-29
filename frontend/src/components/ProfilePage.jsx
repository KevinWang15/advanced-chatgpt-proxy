import React, { useState, useEffect } from 'react';
import { useKeycloak } from '@react-keycloak/web';
import apiClient from '../apiClient';

function ProfilePage() {
  const { keycloak, initialized } = useKeycloak();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialized && keycloak.authenticated) {
      setLoading(true);
      apiClient.get('/users/profile')
        .then(response => {
          setProfile(response.data);
          setLoading(false);
        })
        .catch(err => {
          console.error("Error fetching profile:", err);
          setError('Failed to load profile data.');
          setLoading(false);
        });
    }
  }, [initialized, keycloak.authenticated]);

  if (!initialized || loading) {
    return <div>Loading profile...</div>;
  }

  if (error) {
    return <div style={{ color: 'red' }}>{error}</div>;
  }

  if (!profile) {
    return <div>Could not load profile information.</div>;
  }

  return (
    <div>
      <h2>User Profile</h2>
      <p><strong>Username:</strong> {profile.username}</p>
      <p><strong>Email:</strong> {profile.email}</p>
      <p><strong>Keycloak ID:</strong> {profile.keycloakId}</p>
      <p>
        <strong>Membership Status:</strong> 
        {profile.isMember ? 
          `Active (Expires: ${new Date(profile.membershipExpiresAt).toLocaleDateString()})` : 
          'Inactive'
        }
      </p>
      {/* Display other profile information as needed */}
    </div>
  );
}

export default ProfilePage;

