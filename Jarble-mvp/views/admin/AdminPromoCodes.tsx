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
import { Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";

type DiscountType = "fixed" | "percent";

type PromoCodeRow = {
  id: string;
  code: string;
  discountType: string;
  discountAmount: number;
  maxUses: number | null;
  maxUsesPerUser: number;
  currentUses: number;
  expiresAt: string | Date | null;
  active: boolean;
  createdAt: string | Date;
};

function formatDiscount(row: PromoCodeRow): string {
  return row.discountType === "percent"
    ? `${row.discountAmount}% off`
    : `$${(row.discountAmount / 100).toFixed(2)} off`;
}

function formatDate(value: string | Date | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default function AdminPromoCodes() {
  const utils = trpc.useUtils();
  const codesQuery = trpc.admin.listPromoCodes.useQuery({ page: 1, limit: 100, includeInactive: true });

  const createMutation = trpc.admin.createPromoCode.useMutation({
    onSuccess: () => {
      toast.success("Promo code created");
      utils.admin.listPromoCodes.invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.admin.updatePromoCode.useMutation({
    onSuccess: () => {
      toast.success("Promo code updated");
      utils.admin.listPromoCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [discountAmount, setDiscountAmount] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [maxUsesPerUser, setMaxUsesPerUser] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");

  const [redemptionsFor, setRedemptionsFor] = useState<PromoCodeRow | null>(null);
  const redemptionsQuery = trpc.admin.listPromoRedemptions.useQuery(
    { promoCodeId: redemptionsFor?.id ?? "", page: 1, limit: 100 },
    { enabled: !!redemptionsFor },
  );

  const resetForm = () => {
    setCode("");
    setDiscountType("percent");
    setDiscountAmount("");
    setMaxUses("");
    setMaxUsesPerUser("1");
    setExpiresAt("");
  };

  const handleCreate = () => {
    const amount = Number(discountAmount);
    const cap = Number(maxUsesPerUser);
    if (!code.trim() || !Number.isFinite(amount) || amount < 1) {
      toast.error("Code and discount amount are required");
      return;
    }
    if (!Number.isFinite(cap) || cap < 1) {
      toast.error("Per-user limit must be at least 1");
      return;
    }
    createMutation.mutate({
      code: code.trim().toUpperCase(),
      discountType,
      discountAmount: amount,
      maxUses: maxUses.trim() ? Number(maxUses) : null,
      maxUsesPerUser: cap,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  const handleToggleActive = (row: PromoCodeRow) => {
    updateMutation.mutate({ id: row.id, active: !row.active });
  };

  const handleEditPerUser = (row: PromoCodeRow) => {
    const next = window.prompt(
      `Max uses per user for ${row.code}`,
      String(row.maxUsesPerUser),
    );
    if (!next) return;
    const parsed = Number(next);
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error("Must be at least 1");
      return;
    }
    updateMutation.mutate({ id: row.id, maxUsesPerUser: parsed });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Promo Codes</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create promo code</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="BETA2025"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Discount type</Label>
                  <Select value={discountType} onValueChange={(v) => setDiscountType(v as DiscountType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percent</SelectItem>
                      <SelectItem value="fixed">Fixed (cents)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    type="number"
                    min={1}
                    placeholder={discountType === "percent" ? "100" : "2500"}
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="maxUses">Max total uses</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="perUser">Per-user limit</Label>
                  <Input
                    id="perUser"
                    type="number"
                    min={1}
                    value={maxUsesPerUser}
                    onChange={(e) => setMaxUsesPerUser(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiresAt">Expires at (optional)</Label>
                <Input
                  id="expiresAt"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
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

      {codesQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Per-user</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-40">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {codesQuery.data?.codes.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-sm">{row.code}</TableCell>
                <TableCell>{formatDiscount(row)}</TableCell>
                <TableCell>
                  {row.currentUses} / {row.maxUses ?? "∞"}
                </TableCell>
                <TableCell>
                  <button
                    className="underline decoration-dotted text-sm"
                    onClick={() => handleEditPerUser(row)}
                    title="Click to edit"
                  >
                    {row.maxUsesPerUser}
                  </button>
                </TableCell>
                <TableCell>{formatDate(row.expiresAt)}</TableCell>
                <TableCell>
                  <Switch
                    checked={row.active}
                    onCheckedChange={() => handleToggleActive(row)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRedemptionsFor(row)}
                  >
                    <Users className="w-3.5 h-3.5 mr-1.5" />
                    Redemptions
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {codesQuery.data?.codes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No promo codes yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={!!redemptionsFor} onOpenChange={(open) => !open && setRedemptionsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Redemptions for <span className="font-mono">{redemptionsFor?.code}</span>
            </DialogTitle>
          </DialogHeader>
          {redemptionsQuery.isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Redeemed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {redemptionsQuery.data?.redemptions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.userName || "-"}</TableCell>
                    <TableCell>{r.userEmail || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.deploymentId || "-"}
                    </TableCell>
                    <TableCell>{new Date(r.redeemedAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {redemptionsQuery.data?.redemptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No redemptions yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Badge variant="secondary">
              Total: {redemptionsQuery.data?.total ?? 0}
            </Badge>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
