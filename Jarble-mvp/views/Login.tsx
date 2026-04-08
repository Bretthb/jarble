'use client';

import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ArrowRight, Github, Chrome, Loader2 } from "lucide-react";

import { useAuth0 } from "@auth0/auth0-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const { loginWithRedirect, isLoading, isAuthenticated } = useAuth0();
  const { resolvedTheme } = useTheme();
  const logoSrc = resolvedTheme === "dark" ? "/logodark.png" : "/logo.png";

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleLogin = () => {
    loginWithRedirect({
      authorizationParams: {
        prompt: 'login', // Always show login options
      },
    });
  };

  const handleGoogleLogin = () => {
    loginWithRedirect({
      authorizationParams: {
        connection: 'google-oauth2',
        prompt: 'login',
      },
    });
  };

  const handleGithubLogin = () => {
    loginWithRedirect({
      authorizationParams: {
        connection: 'github',
        prompt: 'login',
      },
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 relative">
      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in-up">
          <Link href="/" className="inline-flex items-center hover:opacity-80 transition-opacity">
            <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-9 w-auto" />
          </Link>
          <h1 className="text-2xl font-serif font-medium mt-6 mb-2">Welcome back</h1>
          <p className="text-muted-foreground">Sign in to your account to continue</p>
        </div>

        {/* Login Form */}
        <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm animate-fade-in-up">
          {/* Main Login Button */}
          <Button
            onClick={handleLogin}
            className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium mb-6"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="inline-block animate-spin mr-2">⚡</span>
            ) : (
              <ArrowRight className="w-4 h-4 mr-2" />
            )}
            {isLoading ? "Loading..." : "Sign in with Email"}
          </Button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-card text-muted-foreground">Or continue with</span>
            </div>
          </div>

          {/* Social Login Buttons */}
          <div className="grid grid-cols-2 gap-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              <Chrome className="w-4 h-4 mr-2" />
              Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              onClick={handleGithubLogin}
              disabled={isLoading}
            >
              <Github className="w-4 h-4 mr-2" />
              GitHub
            </Button>
          </div>

          {/* Sign Up Note */}
          <p className="text-center text-muted-foreground mt-6 text-sm">
            Don't have an account? Click sign in to create one.
          </p>
        </div>

        {/* Back to Home */}
        <p className="text-center text-muted-foreground mt-6">
          <Link href="/" className="hover:text-primary transition-colors">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
