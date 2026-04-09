"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle, Clock, UserCheck } from "lucide-react";

type InviteStatus =
  | "loading"
  | "success"
  | "already-member"
  | "expired"
  | "already-used"
  | "wrong-email"
  | "not-found"
  | "error";

export default function InviteAcceptPage() {
  const { token } = useParams() as { token: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, loginWithRedirect } = useAuth0();
  const { setActiveOrgId } = useOrg();
  const [status, setStatus] = useState<InviteStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const acceptInvite = trpc.org.acceptInvite.useMutation({
    onSuccess: (data) => {
      setOrgId(data.orgId);
      utils.org.list.invalidate();
      if (data.alreadyMember) {
        setStatus("already-member");
        setActiveOrgId(data.orgId);
      } else {
        setStatus("success");
        setActiveOrgId(data.orgId);
      }
      setTimeout(() => router.push(`/orgs/${data.orgId}`), 2000);
    },
    onError: (error) => {
      const msg = error.message;
      if (msg.includes("expired")) {
        setStatus("expired");
      } else if (msg.includes("already been used")) {
        setStatus("already-used");
      } else if (msg.includes("different email")) {
        setStatus("wrong-email");
      } else if (msg.includes("not found")) {
        setStatus("not-found");
      } else {
        setStatus("error");
      }
      setErrorMessage(msg);
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
                Welcome to the organization. Redirecting...
              </p>
            </div>
          </>
        )}

        {status === "already-member" && (
          <>
            <UserCheck className="w-12 h-12 text-blue-500 mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Already a member</h1>
              <p className="text-muted-foreground mt-2">
                You're already part of this organization. Redirecting...
              </p>
            </div>
          </>
        )}

        {status === "expired" && (
          <>
            <Clock className="w-12 h-12 text-amber-500 mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Invite expired</h1>
              <p className="text-muted-foreground mt-2">
                This invite link has expired. Ask the organization admin to send a new one.
              </p>
            </div>
            <Button onClick={() => router.push("/dashboard")} variant="outline">
              Go to Dashboard
            </Button>
          </>
        )}

        {status === "already-used" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-muted-foreground mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Invite already used</h1>
              <p className="text-muted-foreground mt-2">
                This invite has already been accepted. If you're the intended recipient, check your organizations.
              </p>
            </div>
            <Button onClick={() => router.push("/orgs")} variant="outline">
              View Organizations
            </Button>
          </>
        )}

        {status === "wrong-email" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Wrong account</h1>
              <p className="text-muted-foreground mt-2">
                This invite was sent to a different email address. Log in with the correct account to accept it.
              </p>
            </div>
            <Button onClick={() => router.push("/dashboard")} variant="outline">
              Go to Dashboard
            </Button>
          </>
        )}

        {status === "not-found" && (
          <>
            <XCircle className="w-12 h-12 text-muted-foreground mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Invite not found</h1>
              <p className="text-muted-foreground mt-2">
                This invite link is invalid or has been revoked.
              </p>
            </div>
            <Button onClick={() => router.push("/dashboard")} variant="outline">
              Go to Dashboard
            </Button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-destructive mx-auto" />
            <div>
              <h1 className="text-2xl font-serif font-medium">Something went wrong</h1>
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
