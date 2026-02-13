'use client';
import { useAuth0 } from '@auth0/auth0-react';
import { Button } from '@/components/ui/button';

export function LoginButton() {
  const { loginWithRedirect, isLoading } = useAuth0();
  return (
    <Button 
      onClick={() => loginWithRedirect({ 
        authorizationParams: { 
          prompt: 'login' // Always show login options (Google, GitHub, etc.)
        }
      })} 
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : 'Log In'}
    </Button>
  );
}
