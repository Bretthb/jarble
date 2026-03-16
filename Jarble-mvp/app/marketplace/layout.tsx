"use client";

import Link from "next/link";
import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "@/components/ui/button";
import ProfileDropdown from "@/components/ProfileDropdown";

interface MarketplaceLayoutProps {
  children: React.ReactNode;
}

export default function MarketplaceLayout({ children }: MarketplaceLayoutProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <h1 className="font-serif font-bold text-2xl tracking-tight">Jarble</h1>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:inline">
              Home
            </Link>
            <Link href="/marketplace" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Marketplace
            </Link>
            {!authLoading && isAuthenticated ? (
              <>
                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors hidden sm:inline">
                  Dashboard
                </Link>
                <ProfileDropdown />
              </>
            ) : !authLoading ? (
              <Button size="sm" asChild className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </nav>
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}
