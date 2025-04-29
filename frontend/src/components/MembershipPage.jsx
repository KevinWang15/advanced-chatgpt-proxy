import React, { useState, useEffect } from 'react';
import { useKeycloak } from '@react-keycloak/web';
import apiClient from '../apiClient';

function MembershipPage() {
  const { keycloak, initialized } = useKeycloak();
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [redeemStatus, setRedeemStatus] = useState({ message: '', error: false });

  const fetchMembershipStatus = () => {
    setLoading(true);
    apiClient.get('/membership/status')
      .then(response => {
        setMembership(response.data);
        setLoading(false);
        setError(null);
      })
      .catch(err => {
        console.error("Error fetching membership status:", err);
        setError('Failed to load membership status.');
        setLoading(false);
      });
  };

  useEffect(() => {
    if (initialized && keycloak.authenticated) {
      fetchMembershipStatus();
    }
  }, [initialized, keycloak.authenticated]);

  const handleRedeemVoucher = (e) => {
    e.preventDefault();
    setRedeemStatus({ message: 'Redeeming...', error: false });
    apiClient.post('/membership/redeem', { voucherCode })
      .then(response => {
        setRedeemStatus({ message: `Success! Membership extended until ${new Date(response.data.newExpirationDate).toLocaleDateString()}`, error: false });
        setVoucherCode(''); // Clear input field
        // Refresh membership status after successful redemption
        fetchMembershipStatus(); 
      })
      .catch(err => {
        console.error("Error redeeming voucher:", err);
        const errorMessage = err.response?.data?.message || 'Failed to redeem voucher.';
        setRedeemStatus({ message: errorMessage, error: true });
      });
  };

  if (!initialized || loading) {
    return <div>Loading membership details...</div>;
  }

  if (error) {
    return <div style={{ color: 'red' }}>{error}</div>;
  }

  if (!membership) {
    return <div>Could not load membership information.</div>;
  }

  return (
    <div>
      <h2>Membership Details</h2>
      <p>
        <strong>Status:</strong> 
        {membership.isMember ? 
          `Active (Expires: ${new Date(membership.expiresAt).toLocaleDateString()})` : 
          'Inactive'
        }
      </p>
      
      <h3>Redeem Voucher</h3>
      <form onSubmit={handleRedeemVoucher}>
        <div style={{ marginBottom: '10px' }}>
          <label htmlFor="voucherCode">Voucher Code: </label>
          <input 
            type="text" 
            id="voucherCode" 
            value={voucherCode} 
            onChange={(e) => setVoucherCode(e.target.value)} 
            required 
          />
        </div>
        <button type="submit" disabled={!voucherCode}>Redeem</button>
      </form>
      {redeemStatus.message && (
        <p style={{ color: redeemStatus.error ? 'red' : 'green', marginTop: '10px' }}>
          {redeemStatus.message}
        </p>
      )}
    </div>
  );
}

export default MembershipPage;

