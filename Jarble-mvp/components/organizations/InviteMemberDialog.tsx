"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function InviteMemberDialog({
  orgId,
  orgName,
  open,
  onOpenChange,
}: {
  orgId: string;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [emailError, setEmailError] = useState("");
  const utils = trpc.useUtils();

  // Fetch pending invites to check for duplicates
  const invitesQuery = trpc.org.listInvites.useQuery(
    { orgId },
    { enabled: open },
  );

  const inviteMutation = trpc.org.invite.useMutation({
    onSuccess: () => {
      toast.success(`Invite sent to ${email}`);
      utils.org.listInvites.invalidate({ orgId });
      onOpenChange(false);
      setEmail("");
      setRole("member");
      setEmailError("");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const validateEmail = (value: string): string => {
    if (!value.trim()) return "";
    if (!isValidEmail(value.trim())) return "Enter a valid email address";

    // Check for duplicate pending invite
    const pendingInvites = invitesQuery.data ?? [];
    if (pendingInvites.some((inv: any) => inv.email.toLowerCase() === value.trim().toLowerCase())) {
      return "An invite is already pending for this email";
    }

    return "";
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (emailError) {
      setEmailError(validateEmail(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const error = validateEmail(email);
    if (error) {
      setEmailError(error);
      return;
    }
    inviteMutation.mutate({ orgId, email: email.trim(), role });
  };

  const pendingCount = invitesQuery.data?.length ?? 0;
  const atInviteLimit = pendingCount >= 20;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Invite to {orgName}
          </DialogTitle>
          <DialogDescription>
            Send an email invite. They'll be able to join and access the organization's agents.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              onBlur={() => setEmailError(validateEmail(email))}
              autoFocus
              className={emailError ? "border-destructive" : ""}
            />
            {emailError && (
              <p className="text-xs text-destructive">{emailError}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member -- can view and use agents</SelectItem>
                <SelectItem value="admin">Admin -- can invite, remove, and manage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {atInviteLimit && (
            <p className="text-xs text-amber-500">
              You have {pendingCount} pending invites. Cancel some before sending more.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!email.trim() || !!emailError || inviteMutation.isPending || atInviteLimit}
            >
              {inviteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Send Invite"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
