import axios from 'axios';
import keycloak from './keycloak'; // Import the keycloak instance

// Use environment variable for backend URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Add a request interceptor to include the Keycloak token
apiClient.interceptors.request.use(
  async (config) => {
    if (keycloak.authenticated) {
      // Refresh token if needed (keycloak-js handles this)
      try {
        await keycloak.updateToken(5); // Update if expires within 5 seconds
        config.headers.Authorization = `Bearer ${keycloak.token}`;
      } catch (error) {
        console.error('Failed to refresh token or update request header:', error);
        // Optionally trigger logout or show error message
        // keycloak.logout();
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default apiClient;

