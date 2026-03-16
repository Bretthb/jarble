"use client";

import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

export default function DeleteAccountSection() {
  const { logout } = useAuth0();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");

  const isConfirmed = confirmationInput === CONFIRMATION_PHRASE;

  const deleteAccountMutation = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("Account deleted successfully.");
      logout({ logoutParams: { returnTo: window.location.origin } });
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to delete account. Please try again.");
    },
  });

  const handleDelete = () => {
    if (!isConfirmed) return;
    deleteAccountMutation.mutate({ confirmation: CONFIRMATION_PHRASE });
  };

  const handleOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setConfirmationInput("");
    }
  };

  return (
    <Card className="p-6 bg-card border-destructive/30">
      <h3 className="font-semibold mb-1 text-destructive">Danger Zone</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Permanently delete your account and all associated data
      </p>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Delete Account</p>
          <p className="text-xs text-muted-foreground">
            This action is irreversible. All your data will be permanently removed.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setIsDialogOpen(true)}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete Account
        </Button>
      </div>

      <AlertDialog open={isDialogOpen} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account, all your agents, chat
              history, platform connections, and cancel any active subscriptions.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-2">
              Type <span className="font-mono font-semibold text-foreground">{CONFIRMATION_PHRASE}</span> to confirm:
            </p>
            <Input
              value={confirmationInput}
              onChange={(e) => setConfirmationInput(e.target.value)}
              placeholder={CONFIRMATION_PHRASE}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccountMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!isConfirmed || deleteAccountMutation.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteAccountMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              )}
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
