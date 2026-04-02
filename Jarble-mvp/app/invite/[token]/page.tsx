"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function InviteAcceptPage() {
  const { token } = useParams() as { token: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, loginWithRedirect } = useAuth0();
  const { setActiveOrgId } = useOrg();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const acceptInvite = trpc.org.acceptInvite.useMutation({
    onSuccess: (data) => {
      setStatus("success");
      setActiveOrgId(data.orgId);
      setTimeout(() => router.push("/dashboard"), 2000);
    },
    onError: (error) => {
      setStatus("error");
      setErrorMessage(error.message);
    },
  });

  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      loginWithRedirect({
        appState: { returnTo: `/invite/${token}` },
      });
      return;
    }

    // Auto-accept once authenticated
    if (status === "loading" && !acceptInvite.isPending) {
      acceptInvite.mutate({ token });
    }
  }, [isAuthenticated, authLoading, token, status, acceptInvite]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Accepting invite...</h1>
              <p className="text-muted-foreground mt-2">
                {authLoading ? "Checking your account..." : "Joining the organization..."}
              </p>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">You're in!</h1>
              <p className="text-muted-foreground mt-2">
                Redirecting to your dashboard...
              </p>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Invite failed</h1>
              <p className="text-muted-foreground mt-2">{errorMessage}</p>
            </div>
            <Button onClick={() => router.push("/dashboard")} variant="outline">
              Go to Dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
