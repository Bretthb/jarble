"use client";

import MarketingNav from "@/components/marketing/MarketingNav";

interface MarketplaceLayoutProps {
  children: React.ReactNode;
}

export default function MarketplaceLayout({ children }: MarketplaceLayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {children}
      </main>
    </div>
  );
}
