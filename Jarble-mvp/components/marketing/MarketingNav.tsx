"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { useTheme } from "next-themes";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import ProfileDropdown from "@/components/ProfileDropdown";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/marketplace", label: "Marketplace" },
];

export default function MarketingNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuth0();
  const { resolvedTheme } = useTheme();
  const [sheetOpen, setSheetOpen] = useState(false);
  const logoSrc = resolvedTheme === "dark" ? "/logo.png" : "/logodark.png";

  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        {/* Logo */}
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity">
          <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-12 w-auto" priority />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-4">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm font-medium transition-colors ${
                pathname === href
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              {label}
            </Link>
          ))}
          {isAuthenticated ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
              >
                Dashboard
              </Link>
              <ProfileDropdown />
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => router.push("/login")}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
            >
              Sign in
            </Button>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="flex md:hidden items-center gap-2">
          {isAuthenticated ? (
            <ProfileDropdown />
          ) : (
            <Button
              size="sm"
              onClick={() => router.push("/login")}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 font-medium text-xs"
            >
              Sign in
            </Button>
          )}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[260px] p-0">
              <SheetHeader className="px-4 pt-4 pb-2">
                <SheetTitle className="text-left">
                  <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-10 w-auto" />
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col py-2">
                {NAV_LINKS.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setSheetOpen(false)}
                    className={`px-4 py-3 text-sm font-medium transition-colors ${
                      pathname === href
                        ? "text-primary bg-secondary/50"
                        : "text-muted-foreground hover:text-primary hover:bg-secondary/30"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
                {isAuthenticated && (
                  <Link
                    href="/dashboard"
                    onClick={() => setSheetOpen(false)}
                    className="px-4 py-3 text-sm font-medium text-muted-foreground hover:text-primary hover:bg-secondary/30 transition-colors border-t border-border mt-2 pt-4"
                  >
                    Dashboard
                  </Link>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
