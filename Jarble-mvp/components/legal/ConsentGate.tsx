"use client";

import { useState } from "react";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CURRENT_TOS_VERSION } from "@/lib/consent";
import { toast } from "sonner";

export interface ConsentGateProps {
  /**
   * Called after the user successfully accepts the terms and the server
   * confirms the write. Parent components should refetch the user
   * profile or continue the onboarding flow here.
   */
  onAccepted?: () => void;
  /**
   * Render the full primary Accept button (true — used inside the
   * returning-user modal) or just the checkbox and copy (false — used
   * inline inside the first onboarding step where an existing Continue
   * button handles submission). Defaults to false.
   */
  showAcceptButton?: boolean;
  /**
   * Callback so parent forms can read the checked state — used by
   * StepName to disable its own Continue button until the gate is
   * satisfied.
   */
  onCheckedChange?: (checked: boolean) => void;
  /**
   * External controlled value for the checkbox. When omitted the
   * component manages its own internal state.
   */
  checked?: boolean;
}

/**
 * Shared Terms of Service + Privacy Policy consent UI.
 *
 * Used in two places:
 *   1. `StepName.tsx` — inline inside the first onboarding wizard step
 *      for brand-new users. The wizard's own Continue button stays
 *      disabled until `onCheckedChange(true)` fires.
 *   2. `ConsentModal.tsx` — a global, undismissable modal shown on any
 *      authenticated page when the current user has a null
 *      `tosAcceptedAt`. That modal passes `showAcceptButton` so the
 *      Accept button lives inside the gate itself.
 *
 * Both paths call `trpc.user.acceptTerms` which writes tosAcceptedAt,
 * tosVersion, and privacyAcceptedAt on the user row. The legal links
 * open `/terms` and `/privacy` in a new tab so the user never leaves
 * the consent flow.
 */
export function ConsentGate({
  onAccepted,
  showAcceptButton = false,
  onCheckedChange,
  checked: externalChecked,
}: ConsentGateProps) {
  const [internalChecked, setInternalChecked] = useState(false);
  const checked = externalChecked ?? internalChecked;

  const utils = trpc.useUtils();
  const acceptMutation = trpc.user.acceptTerms.useMutation({
    onSuccess: async () => {
      await utils.user.getProfile.invalidate();
      onAccepted?.();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to record consent. Please try again.");
    },
  });

  const handleCheckedChange = (value: boolean) => {
    if (externalChecked === undefined) {
      setInternalChecked(value);
    }
    onCheckedChange?.(value);
  };

  const handleAccept = () => {
    if (!checked) return;
    acceptMutation.mutate({ tosVersion: CURRENT_TOS_VERSION });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Checkbox
          id="consent-gate"
          checked={checked}
          onCheckedChange={(value) => handleCheckedChange(value === true)}
          disabled={acceptMutation.isPending}
          aria-describedby="consent-gate-description"
        />
        <Label
          htmlFor="consent-gate"
          id="consent-gate-description"
          className="text-sm leading-relaxed cursor-pointer"
        >
          I agree to Jarble&apos;s{" "}
          <Link
            href="/legal/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-primary"
            data-testid="consent-terms-link"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-primary"
            data-testid="consent-privacy-link"
          >
            Privacy Policy
          </Link>
          .
        </Label>
      </div>

      {showAcceptButton && (
        <Button
          type="button"
          onClick={handleAccept}
          disabled={!checked || acceptMutation.isPending}
          className="w-full"
          data-testid="consent-accept-button"
        >
          {acceptMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Continue"
          )}
        </Button>
      )}
    </div>
  );
}
