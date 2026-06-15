"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConsentGate } from "@/components/legal/ConsentGate";
import { trpc } from "@/lib/trpc";
import { needsConsent } from "@/lib/consent";

/**
 * Paths where the consent modal must NOT render even for users who
 * still need to accept. A user has to be able to reach the legal pages
 * to read what they are agreeing to, and has to be able to sign in /
 * sign out in case they never intend to accept.
 */
const CONSENT_EXEMPT_PATHS = [
  "/login",
  "/register",
  "/legal/terms",
  "/legal/privacy",
  "/terms",
  "/privacy",
  "/about",
  "/research",
  "/pricing",
  "/", // marketing home
];

function isExemptPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return CONSENT_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Global undismissable consent modal for returning users (JAR-TOS).
 *
 * Mounted at the Providers level so it can appear on every
 * authenticated page. Shows when:
 *   1. Auth0 reports the user is authenticated AND
 *   2. The server profile query has loaded AND
 *   3. Profile.tosAcceptedAt is null AND
 *   4. The current pathname is not in CONSENT_EXEMPT_PATHS
 *
 * The dialog blocks Escape, outside-click, and close button so the
 * user cannot skip it. Accepting fires trpc.user.acceptTerms which
 * invalidates the profile query, the needsConsent check flips, and the
 * dialog unmounts naturally.
 *
 * This is the catch-all for legacy users who existed before the
 * migration added the consent fields — their tosAcceptedAt is null
 * after deploy and they see this on first login.
 */
export function ConsentModal() {
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const pathname = usePathname();

  const profileQuery = trpc.user.getProfile.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
    // Consent state changes rarely — don't hammer the API.
    staleTime: 60_000,
  });

  const shouldShow = useMemo(() => {
    if (authLoading) return false;
    if (!isAuthenticated) return false;
    if (profileQuery.isLoading) return false;
    if (!needsConsent(profileQuery.data)) return false;
    if (isExemptPath(pathname)) return false;
    return true;
  }, [authLoading, isAuthenticated, profileQuery.isLoading, profileQuery.data, pathname]);

  if (!shouldShow) return null;

  return (
    <Dialog open modal>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-lg"
        data-testid="consent-modal"
      >
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
          <DialogDescription>
            We&apos;ve updated how Jarble handles your data. Please review
            and accept the Terms of Service and Privacy Policy to keep
            using your deployments.
          </DialogDescription>
        </DialogHeader>
        <ConsentGate showAcceptButton />
      </DialogContent>
    </Dialog>
  );
}
