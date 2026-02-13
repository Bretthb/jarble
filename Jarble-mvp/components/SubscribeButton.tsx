'use client';

import { useState } from 'react';

type TierName = 'pro' | 'agency';

interface SubscribeButtonProps {
  tier: TierName;
  currentTier?: string;
  className?: string;
}

export function SubscribeButton({ tier, currentTier, className }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);

  const isCurrentTier = currentTier === tier;
  const isUpgrade = tier === 'agency' && currentTier === 'pro';
  const isDowngrade = tier === 'pro' && currentTier === 'agency';

  const handleClick = async () => {
    if (isCurrentTier) {
      // Open customer portal to manage subscription
      await openPortal();
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });

      const data = await response.json();

      if (data.redirectToPortal) {
        await openPortal();
        return;
      }

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        console.error('No checkout URL returned');
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
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
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

  const handleClick = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
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
