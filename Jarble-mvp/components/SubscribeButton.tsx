'use client';

import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type TierName = 'pro' | 'agency';

interface SubscribeButtonProps {
  tier: TierName;
  currentTier?: string;
  className?: string;
}

export function SubscribeButton({ tier, currentTier, className }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);
  const { getAccessTokenSilently, isAuthenticated, loginWithRedirect } = useAuth0();

  const isCurrentTier = currentTier === tier;
  const isUpgrade = tier === 'agency' && currentTier === 'pro';
  const isDowngrade = tier === 'pro' && currentTier === 'agency';

  const getAuthHeaders = async () => {
    const token = await getAccessTokenSilently();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };

  const handleClick = async () => {
    if (!isAuthenticated) {
      loginWithRedirect();
      return;
    }

    if (isCurrentTier) {
      await openPortal();
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/stripe/checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tier }),
      });

      const data = await response.json();

      if (data.redirectToPortal) {
        await openPortal();
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error('Checkout error:', data.error);
      }
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setLoading(false);
    }
  };

  const openPortal = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/stripe/portal`, {
        method: 'POST',
        headers,
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error('Portal error:', data.error);
      }
    } catch (error) {
      console.error('Portal error:', error);
    } finally {
      setLoading(false);
    }
  };

  const buttonText = isCurrentTier
    ? 'Manage Subscription'
    : isUpgrade
    ? 'Upgrade'
    : isDowngrade
    ? 'Downgrade'
    : 'Subscribe';

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
        isCurrentTier
          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      } disabled:opacity-50 ${className}`}
    >
      {loading ? 'Loading...' : buttonText}
    </button>
  );
}

// Manage subscription button (for existing subscribers)
export function ManageSubscriptionButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const { getAccessTokenSilently } = useAuth0();

  const handleClick = async () => {
    setLoading(true);
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch(`${API_URL}/api/stripe/portal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error('Portal error:', data.error);
      }
    } catch (error) {
      console.error('Portal error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`px-4 py-2 text-sm text-gray-600 hover:text-gray-900 ${className}`}
    >
      {loading ? 'Loading...' : 'Manage Billing'}
    </button>
  );
}
