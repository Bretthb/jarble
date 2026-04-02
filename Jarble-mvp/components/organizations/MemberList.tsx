"use client";

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useOrg } from "@/contexts/OrgContext";
import { MoreHorizontal, Shield, ShieldCheck, User, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  joinedAt: string;
}

const ROLE_ICONS: Record<string, typeof User> = {
  owner: Crown,
  admin: ShieldCheck,
  member: User,
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export default function MemberList({
  orgId,
  members,
  currentUserId,
}: {
  orgId: string;
  members: Member[];
  currentUserId: string;
}) {
  const { activeOrg } = useOrg();
  const utils = trpc.useUtils();

  const callerRole = activeOrg?.role ?? "member";
  const canManage = callerRole === "owner" || callerRole === "admin";

  const removeMember = trpc.org.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      utils.org.getById.invalidate({ orgId });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateRole = trpc.org.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      utils.org.getById.invalidate({ orgId });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-1">
      {members.map((member) => {
        const RoleIcon = ROLE_ICONS[member.role] ?? User;
        const isCurrentUser = member.userId === currentUserId;
        const isOwner = member.role === "owner";

        return (
          <div
            key={member.id}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/30 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
              <RoleIcon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {member.name || member.email}
                {isCurrentUser && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                )}
              </p>
              {member.name && member.email && (
                <p className="text-xs text-muted-foreground truncate">{member.email}</p>
              )}
            </div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-2 py-0.5 rounded bg-secondary/50">
              {ROLE_LABELS[member.role] ?? member.role}
            </span>
            {canManage && !isCurrentUser && !isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {callerRole === "owner" && member.role === "member" && (
                    <DropdownMenuItem
                      onClick={() => updateRole.mutate({ orgId, userId: member.userId, role: "admin" })}
                    >
                      <Shield className="w-4 h-4" />
                      Make Admin
                    </DropdownMenuItem>
                  )}
                  {callerRole === "owner" && member.role === "admin" && (
                    <DropdownMenuItem
                      onClick={() => updateRole.mutate({ orgId, userId: member.userId, role: "member" })}
                    >
                      <User className="w-4 h-4" />
                      Make Member
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => removeMember.mutate({ orgId, userId: member.userId })}
                  >
                    Remove from Organization
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
    </div>
  );
}
