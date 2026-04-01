"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth0 } from "@auth0/auth0-react";
import { toast } from "sonner";
import { Building2, Loader2, Mail, Save, Trash2, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import MemberList from "./MemberList";
import InviteMemberDialog from "./InviteMemberDialog";

export default function OrgSettings() {
  const { activeOrgId, activeOrg, setActiveOrgId } = useOrg();
  const { user } = useAuth0();
  const utils = trpc.useUtils();

  const orgQuery = trpc.org.getById.useQuery(
    { orgId: activeOrgId! },
    { enabled: !!activeOrgId },
  );

  const invitesQuery = trpc.org.listInvites.useQuery(
    { orgId: activeOrgId! },
    { enabled: !!activeOrgId && (activeOrg?.role === "owner" || activeOrg?.role === "admin") },
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
      utils.org.getById.invalidate({ orgId: activeOrgId! });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteOrg = trpc.org.delete.useMutation({
    onSuccess: () => {
      toast.success("Organization deleted");
      setActiveOrgId(null);
      utils.org.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const leaveOrg = trpc.org.leave.useMutation({
    onSuccess: () => {
      toast.success("Left organization");
      setActiveOrgId(null);
      utils.org.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelInvite = trpc.org.cancelInvite.useMutation({
    onSuccess: () => {
      toast.success("Invite cancelled");
      utils.org.listInvites.invalidate({ orgId: activeOrgId! });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!activeOrgId || !activeOrg) return null;

  if (orgQuery.isLoading) {
    return (
      <Card className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  const org = orgQuery.data;
  if (!org) return null;

  const canEdit = activeOrg.role === "owner" || activeOrg.role === "admin";
  const isOwner = activeOrg.role === "owner";
  const hasNameChanged = name !== org.name;

  return (
    <div className="space-y-6">
      {/* Org Info */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Organization</h3>
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
                  onClick={() => updateOrg.mutate({ orgId: activeOrgId, name: name.trim() })}
                  disabled={!name.trim() || updateOrg.isPending}
                >
                  {updateOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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
          orgId={activeOrgId}
          members={org.members}
          currentUserId={user?.sub || ""}
        />

        {/* Pending invites */}
        {canEdit && invitesQuery.data && invitesQuery.data.length > 0 && (
          <div className="pt-4 border-t border-border space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Pending Invites</p>
            {invitesQuery.data.map((inv: any) => (
              <div key={inv.id} className="flex items-center gap-3 p-2 rounded-lg bg-secondary/20">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm flex-1 truncate">{inv.email}</span>
                <span className="text-xs text-muted-foreground">{inv.role}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cancelInvite.mutate({ inviteId: inv.id })}
                  className="text-xs h-7"
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

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
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm(`Delete "${org.name}"? This cannot be undone.`)) {
                  deleteOrg.mutate({ orgId: activeOrgId });
                }
              }}
              disabled={deleteOrg.isPending}
            >
              {deleteOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Leave organization</p>
              <p className="text-sm text-muted-foreground">
                Your deployments assigned to this org will return to personal mode.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm(`Leave "${org.name}"?`)) {
                  leaveOrg.mutate({ orgId: activeOrgId });
                }
              }}
              disabled={leaveOrg.isPending}
            >
              {leaveOrg.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Leave
            </Button>
          </div>
        )}
      </Card>

      <InviteMemberDialog
        orgId={activeOrgId}
        orgName={org.name}
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />
    </div>
  );
}
