"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shield,
  Bot,
  User,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

interface SecretsTabProps {
  deploymentId: string;
}

export function SecretsTab({ deploymentId }: SecretsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const secretsQuery = trpc.deploymentSecrets.getByDeployment.useQuery(
    { deploymentId },
    { enabled: !!deploymentId },
  );

  const saveMutation = trpc.deploymentSecrets.save.useMutation({
    onSuccess: () => {
      toast.success(editingKey ? "Secret updated" : "Secret added");
      utils.deploymentSecrets.getByDeployment.invalidate({ deploymentId });
      closeDialog();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.deploymentSecrets.delete.useMutation({
    onSuccess: () => {
      toast.success("Secret deleted");
      utils.deploymentSecrets.getByDeployment.invalidate({ deploymentId });
      setDeleteKey(null);
    },
    onError: (err) => toast.error(err.message),
  });

  function openAdd() {
    setEditingKey(null);
    setKeyInput("");
    setValueInput("");
    setDialogOpen(true);
  }

  function openEdit(key: string) {
    setEditingKey(key);
    setKeyInput(key);
    setValueInput("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingKey(null);
    setKeyInput("");
    setValueInput("");
  }

  function handleSave() {
    const key = keyInput.trim();
    const value = valueInput;
    if (!key || !value) {
      toast.error("Both key and value are required");
      return;
    }
    saveMutation.mutate({ deploymentId, key, value });
  }

  const secrets = secretsQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Secrets & Environment Variables</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Encrypted key-value pairs injected as environment variables into your agent pod.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Secret
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3">
        <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <p className="text-sm text-blue-800 dark:text-blue-300">
          Secrets are encrypted at rest (AES-256-GCM) and injected as environment variables.
          Your agent can also store secrets programmatically. Changes trigger a process restart (~5-10s).
        </p>
      </div>

      {/* Secrets list */}
      {secretsQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : secrets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <KeyRound className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No secrets configured yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add API keys, tokens, or other sensitive values your agent needs
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {secrets.map((secret) => (
            <div
              key={secret.id}
              className="flex items-center justify-between rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <KeyRound className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono font-medium">{secret.key}</code>
                    {secret.source === "agent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">
                        <Bot className="h-3 w-3" /> agent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <User className="h-3 w-3" /> user
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                    {secret.maskedValue}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEdit(secret.key)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => setDeleteKey(secret.key)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingKey ? "Edit Secret" : "Add Secret"}</DialogTitle>
            <DialogDescription>
              {editingKey
                ? "Enter the new value for this secret."
                : "Add an environment variable that will be available in your agent pod."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="secret-key">Key</Label>
              <Input
                id="secret-key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                placeholder="MY_API_KEY"
                disabled={!!editingKey}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Uppercase letters, digits, and underscores only
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-value">Value</Label>
              <Input
                id="secret-value"
                type="password"
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                placeholder="sk-..."
                className="font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!keyInput.trim() || !valueInput || saveMutation.isPending}
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingKey ? "Update" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteKey}
        onOpenChange={(open) => !open && setDeleteKey(null)}
        title="Delete Secret"
        description={`Are you sure you want to delete "${deleteKey}"? This will trigger a pod restart.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteKey && deleteMutation.mutate({ deploymentId, key: deleteKey })}
      />
    </div>
  );
}
