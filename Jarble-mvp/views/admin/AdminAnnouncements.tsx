"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Severity = "info" | "warning" | "critical";

type Announcement = {
  id: string;
  message: string;
  severity: string;
  active: boolean;
  dismissible: boolean;
  audience: string;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  createdAt: string | Date;
};

const SEVERITY_BADGE: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  warning: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  critical: "bg-red-500/15 text-red-600 border-red-500/30",
};

function formatDate(value: string | Date | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function AdminAnnouncements() {
  const utils = trpc.useUtils();
  const listQuery = trpc.admin.listAnnouncements.useQuery({ page: 1, limit: 100 });

  const invalidate = () => {
    utils.admin.listAnnouncements.invalidate();
    utils.user.getActiveAnnouncement.invalidate();
  };

  const createMutation = trpc.admin.createAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement created");
      invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.admin.updateAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement updated");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.admin.deleteAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement deleted");
      invalidate();
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<Severity>("info");
  const [dismissible, setDismissible] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const resetForm = () => {
    setMessage("");
    setSeverity("info");
    setDismissible(true);
    setStartsAt("");
    setEndsAt("");
  };

  const handleCreate = () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Message is required");
      return;
    }
    createMutation.mutate({
      message: trimmed,
      severity,
      dismissible: severity === "critical" ? false : dismissible,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
    });
  };

  const handleToggleActive = (row: Announcement) => {
    updateMutation.mutate({ id: row.id, active: !row.active });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New announcement
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New announcement</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="message">
                  Message <span className="text-muted-foreground">({message.length}/280)</span>
                </Label>
                <Input
                  id="message"
                  maxLength={280}
                  placeholder="Scheduled maintenance at 8pm UTC"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info (blue)</SelectItem>
                    <SelectItem value="warning">Warning (amber)</SelectItem>
                    <SelectItem value="critical">Critical (red, non-dismissible)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {severity !== "critical" && (
                <div className="flex items-center gap-3">
                  <Switch
                    id="dismissible"
                    checked={dismissible}
                    onCheckedChange={setDismissible}
                  />
                  <Label htmlFor="dismissible">Users can dismiss</Label>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="startsAt">Starts (optional)</Label>
                  <Input
                    id="startsAt"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endsAt">Ends (optional)</Label>
                  <Input
                    id="endsAt"
                    type="datetime-local"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <p className="text-sm text-muted-foreground">
        Only one announcement can be active at a time — activating a new one turns the rest off. Users dismiss per-announcement via localStorage; critical severity banners cannot be dismissed.
      </p>

      {listQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Message</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Window</TableHead>
              <TableHead>Dismissible</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.data?.announcements.map((row: Announcement) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-md">
                  <span className="line-clamp-2">{row.message}</span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={SEVERITY_BADGE[row.severity] ?? ""}
                  >
                    {row.severity}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.startsAt || row.endsAt ? (
                    <>
                      <div>{formatDate(row.startsAt) || "now"}</div>
                      <div>→ {formatDate(row.endsAt) || "forever"}</div>
                    </>
                  ) : (
                    "always"
                  )}
                </TableCell>
                <TableCell>{row.dismissible ? "Yes" : "No"}</TableCell>
                <TableCell>
                  <Switch
                    checked={row.active}
                    onCheckedChange={() => handleToggleActive(row)}
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(row.createdAt)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(row)}
                    aria-label="Delete announcement"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {listQuery.data?.announcements.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No announcements yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete announcement?"
        description={deleteTarget ? `"${deleteTarget.message}" will be permanently removed.` : ""}
        confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}
