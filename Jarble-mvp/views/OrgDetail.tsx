"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { useOrg } from "@/contexts/OrgContext";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  CreditCard,
  DollarSign,
  ExternalLink,
  Loader2,
  LogOut,
  Mail,
  Save,
  Trash2,
  Users,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ProfileDropdown from "@/components/ProfileDropdown";
import MemberList from "@/components/organizations/MemberList";
import InviteMemberDialog from "@/components/organizations/InviteMemberDialog";

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function subscriptionStatusBadge(status: string) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500">
          Active
        </span>
      );
    case "past_due":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
          Past Due
        </span>
      );
    case "canceled":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500">
          Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground capitalize">
          {status}
        </span>
      );
  }
}

// ─── Org Billing Section ──────────────────────────────────────────────────

function OrgBillingSection({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const utils = trpc.useUtils();

  const billingQuery = trpc.org.getBilling.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  const createBillingPortal = trpc.org.createBillingPortal.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => toast.error(err.message || "Failed to open billing portal"),
  });

  // Setup creates a Stripe customer, then opens the portal to add a payment method
  const setupBilling = trpc.org.setupBilling.useMutation({
    onSuccess: () => {
      utils.org.getBilling.invalidate({ orgId });
      // After creating the Stripe customer, open the portal to add payment method
      createBillingPortal.mutate({ orgId });
    },
    onError: (err) => toast.error(err.message || "Failed to set up billing"),
  });

  if (billingQuery.isLoading) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Billing</h3>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
    );
  }

  if (billingQuery.isError) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Billing</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Failed to load billing information.
        </p>
        <Button variant="outline" size="sm" onClick={() => billingQuery.refetch()}>
          Retry
        </Button>
      </Card>
    );
  }

  const billing = billingQuery.data;
  const hasPaymentMethod = !!billing?.hasPaymentMethod;

  // No payment method set up
  if (!hasPaymentMethod) {
    return (
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Billing</h3>
        </div>
        <div className="rounded-lg border border-border bg-secondary/20 p-4 text-center space-y-3">
          <DollarSign className="w-8 h-8 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Set up billing to create deployments in this organization
          </p>
          {isOwner ? (
            <Button
              size="sm"
              onClick={() => setupBilling.mutate({ orgId })}
              disabled={setupBilling.isPending || createBillingPortal.isPending}
            >
              {setupBilling.isPending || createBillingPortal.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4 mr-1.5" />
              )}
              Set Up Billing
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only the organization owner can set up billing.
            </p>
          )}
        </div>
      </Card>
    );
  }

  // Payment method exists — show billing overview
  const deployments = billing?.deployments ?? [];
  const totalMonthlyCents = billing?.totalMonthlyCents ?? 0;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Billing</h3>
        </div>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => createBillingPortal.mutate({ orgId })}
            disabled={createBillingPortal.isPending}
          >
            {createBillingPortal.isPending ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-1.5" />
            )}
            Manage Billing
          </Button>
        )}
      </div>

      {/* Monthly cost summary */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/20 px-4 py-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <DollarSign className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Monthly Total</p>
          <p className="text-xl font-bold">{formatCents(totalMonthlyCents)}/mo</p>
        </div>
      </div>

      {/* Billing email */}
      {billing?.billingEmail && (
        <div className="text-sm text-muted-foreground">
          Billing email: <span className="text-foreground">{billing.billingEmail}</span>
        </div>
      )}

      {/* Deployment list */}
      {deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No deployments in this organization yet.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Deployments ({deployments.length})
          </p>
          {deployments.map((dep: any) => (
            <div
              key={dep.id}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/20"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{dep.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCents(dep.monthlyPriceCents ?? 0)}/mo
                </p>
              </div>
              {dep.status && subscriptionStatusBadge(
                dep.cancelledAt ? "canceled" : dep.status === "running" ? "active" : dep.status
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function OrgDetailView() {
  const { orgId } = useParams() as { orgId: string };
  const router = useRouter();
  const { user } = useAuth0();
  const { orgs, setActiveOrgId } = useOrg();
  const utils = trpc.useUtils();

  // Find user's membership for this org
  const membership = orgs.find((o) => o.id === orgId);

  const orgQuery = trpc.org.getById.useQuery(
    { orgId },
    { enabled: !!orgId },
  );

  const canManageInvites = !!membership && (membership.role === "owner" || membership.role === "admin");

  const invitesQuery = trpc.org.listInvites.useQuery(
    { orgId },
    { enabled: !!orgId && canManageInvites },
  );

  const [name, setName] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Initialize name from query data
  if (orgQuery.data && !nameInitialized) {
    setName(orgQuery.data.name);
    setNameInitialized(true);
  }

  const updateOrg = trpc.org.update.useMutation({
    onSuccess: () => {
      toast.success("Organization updated");
      utils.org.list.invalidate();
      utils.org.getById.invalidate({ orgId });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteOrg = trpc.org.delete.useMutation({
    onSuccess: () => {
      toast.success("Organization deleted");
      setActiveOrgId(null);
      utils.org.list.invalidate();
      router.push("/orgs");
    },
    onError: (err) => toast.error(err.message),
  });

  const leaveOrg = trpc.org.leave.useMutation({
    onSuccess: () => {
      toast.success("Left organization");
      setActiveOrgId(null);
      utils.org.list.invalidate();
      router.push("/orgs");
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelInvite = trpc.org.cancelInvite.useMutation({
    onSuccess: () => {
      toast.success("Invite cancelled");
      utils.org.listInvites.invalidate({ orgId });
    },
    onError: (err) => toast.error(err.message),
  });

  const resendInvite = trpc.org.invite.useMutation({
    onSuccess: () => {
      toast.success("Invite resent");
      utils.org.listInvites.invalidate({ orgId });
    },
    onError: (err) => toast.error(err.message),
  });

  if (orgQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-background/95 backdrop-blur">
          <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
            <Skeleton className="h-6 w-48" />
            <ProfileDropdown />
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-60 w-full" />
        </main>
      </div>
    );
  }

  const org = orgQuery.data;
  // Show not-found UI if:
  //   - the getById query errored (NOT_FOUND, wrong membership, etc.)
  //   - OR the server returned no data
  //   - OR the user isn't a member of this org (context mismatch)
  if (orgQuery.isError || !org || !membership) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-6">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-medium">Organization not found</h2>
          <p className="text-sm text-muted-foreground">
            This organization doesn't exist or you're not a member.
          </p>
          <Button variant="outline" onClick={() => router.push("/orgs")}>
            Back to Organizations
          </Button>
        </div>
      </div>
    );
  }

  const canEdit = membership.role === "owner" || membership.role === "admin";
  const isOwner = membership.role === "owner";
  const hasNameChanged = name !== org.name;

  const handleResendInvite = async (invite: { id: string; email: string; role: string }) => {
    await cancelInvite.mutateAsync({ inviteId: invite.id });
    resendInvite.mutate({ orgId, email: invite.email, role: invite.role as "admin" | "member" });
  };

  const formatExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    const hoursLeft = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60)));
    if (hoursLeft < 1) return "Expiring soon";
    if (hoursLeft < 24) return `${hoursLeft}h left`;
    const daysLeft = Math.floor(hoursLeft / 24);
    return `${daysLeft}d left`;
  };

  const isExpiringSoon = (expiresAt: string) => {
    const expiry = new Date(expiresAt);
    const now = new Date();
    return expiry.getTime() - now.getTime() < 24 * 60 * 60 * 1000;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push("/orgs")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-serif font-medium">{org.name}</h1>
            </div>
          </div>
          <ProfileDropdown />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Org Info */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Details</h3>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <div className="flex gap-2">
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canEdit}
                  maxLength={100}
                />
                {canEdit && hasNameChanged && (
                  <Button
                    size="sm"
                    onClick={() => updateOrg.mutate({ orgId, name: name.trim() })}
                    disabled={!name.trim() || updateOrg.isPending}
                  >
                    {updateOrg.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Slug: <code className="bg-secondary/50 px-1.5 py-0.5 rounded">{org.slug}</code>
            </div>
          </div>
        </Card>

        {/* Members */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold">Members ({org.members.length})</h3>
            </div>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setInviteDialogOpen(true)}>
                <Mail className="w-4 h-4" />
                Invite
              </Button>
            )}
          </div>

          <MemberList
            orgId={orgId}
            members={org.members}
            currentUserId={user?.sub || ""}
          />

          {/* Pending invites */}
          {canEdit && invitesQuery.data && invitesQuery.data.length > 0 && (
            <div className="pt-4 border-t border-border space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                Pending Invites ({invitesQuery.data.length})
              </p>
              {invitesQuery.data.map((inv: any) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/20"
                >
                  <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm flex-1 truncate">{inv.email}</span>
                  <span className="text-xs text-muted-foreground">{inv.role}</span>
                  {inv.expiresAt && (
                    <span
                      className={`text-xs ${
                        isExpiringSoon(inv.expiresAt)
                          ? "text-amber-500 font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {formatExpiry(inv.expiresAt)}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleResendInvite(inv)}
                    disabled={resendInvite.isPending || cancelInvite.isPending}
                    className="text-xs h-7"
                    title="Resend invite"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancelInvite.mutate({ inviteId: inv.id })}
                    disabled={cancelInvite.isPending}
                    className="text-xs h-7"
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Billing — visible to owner and admin only */}
        {canEdit && (
          <OrgBillingSection orgId={orgId} isOwner={isOwner} />
        )}

        {/* Danger Zone */}
        <Card className="p-6 border-destructive/20">
          <h3 className="text-lg font-semibold text-destructive mb-4">Danger Zone</h3>
          {isOwner ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete organization</p>
                <p className="text-sm text-muted-foreground">
                  All deployments will return to personal mode. Members will be removed.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleteOrg.isPending}>
                    {deleteOrg.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete organization?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete <strong>{org.name}</strong>. All
                      deployments owned by the org will return to personal mode and
                      all members will lose access. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteOrg.mutate({ orgId })}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Leave organization</p>
                <p className="text-sm text-muted-foreground">
                  Your deployments assigned to this org will return to personal mode.
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={leaveOrg.isPending}>
                    {leaveOrg.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogOut className="w-4 h-4" />
                    )}
                    Leave
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave organization?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You'll lose access to <strong>{org.name}</strong> and any
                      deployments you assigned to it will return to your personal
                      workspace.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => leaveOrg.mutate({ orgId })}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Leave
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </Card>
      </main>

      <InviteMemberDialog
        orgId={orgId}
        orgName={org.name}
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />
    </div>
  );
}
