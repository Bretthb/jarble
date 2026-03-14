"use client";

import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useRouter } from "next/navigation";
import {
  Loader2,
  ChevronLeft,
  CreditCard,
  Receipt,
  DollarSign,
  Layers,
  FileText,
  ExternalLink,
  AlertCircle,
  Zap,
  Link2,
} from "lucide-react";
import { motion } from "framer-motion";
import ProfileDropdown from "@/components/ProfileDropdown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

function statusBadge(status: string, cancelledAt?: string | null) {
  if (cancelledAt) {
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
        Cancelling
      </Badge>
    );
  }

  const config: Record<string, { className: string; label: string }> = {
    active: { className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", label: "Active" },
    paid: { className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", label: "Paid" },
    past_due: { className: "bg-red-500/10 text-red-500 border-red-500/20", label: "Past Due" },
    open: { className: "bg-amber-500/10 text-amber-500 border-amber-500/20", label: "Open" },
  };

  const c = config[status];
  if (c) {
    return <Badge variant="outline" className={c.className}>{c.label}</Badge>;
  }

  return (
    <Badge variant="outline" className="bg-muted text-muted-foreground capitalize">
      {status}
    </Badge>
  );
}

// ─── Managed Key Usage Cell ──────────────────────────────────────────────

function ManagedKeyUsageCell({ deploymentId, limitDollars }: { deploymentId: string; limitDollars: number | null }) {
  const usageQuery = trpc.billing.getManagedKeyUsage.useQuery(
    { deploymentId },
    { staleTime: 60_000 }
  );

  if (usageQuery.isLoading) return <Skeleton className="h-4 w-16" />;
  if (!usageQuery.data) return <span className="text-muted-foreground">—</span>;

  const { usage, limit } = usageQuery.data;
  return (
    <span className="text-xs font-mono">
      ${usage.toFixed(2)} / ${(limit ?? limitDollars ?? 0).toFixed(0)}
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function Billing() {
  const { isAuthenticated, isLoading: authLoading, getAccessTokenSilently } = useAuth0();
  const router = useRouter();

  const overviewQuery = trpc.billing.getOverview.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
    retry: 1,
  });
  const invoicesQuery = trpc.billing.getInvoices.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
    retry: 1,
  });
  const subsQuery = trpc.billing.getSubscriptions.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
    retry: 1,
  });

  const [billingLoading, setBillingLoading] = useState(false);

  const handleManageBilling = async () => {
    setBillingLoading(true);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/stripe/portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Portal returned ${res.status}`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (err) {
      console.error("Portal error:", err);
      toast.error("Failed to open billing portal. Please try again.");
      setBillingLoading(false);
    }
  };

  // ── Auth guards ──
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border text-center">
          <p className="text-muted-foreground mb-4">Please log in to view billing</p>
          <Button onClick={() => (window.location.href = "/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  const overviewSettled = !overviewQuery.isLoading;
  const overview = overviewQuery.data;
  const invoices = invoicesQuery.data ?? [];
  const subs = subsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              <span className="font-semibold">Billing</span>
            </div>
          </div>
          <ProfileDropdown />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* ── Overview Cards ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Monthly Spend</span>
            </div>
            <div className="text-2xl font-bold">
              {!overviewSettled ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                formatCents(overview?.totalMonthlyCents ?? 0)
              )}
            </div>
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Active Subscriptions</span>
            </div>
            <div className="text-2xl font-bold">
              {!overviewSettled ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                overview?.activeSubscriptionCount ?? 0
              )}
            </div>
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Receipt className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Next Payment</span>
            </div>
            <div className="text-2xl font-bold">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : overview?.nextBillingDate ? (
                formatDate(overview.nextBillingDate)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Payment Method</span>
            </div>
            <div className="text-2xl font-bold">
              {overviewQuery.isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : overview?.paymentMethodLast4 ? (
                <span className="text-lg">···· {overview.paymentMethodLast4}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </Card>
        </motion.div>

        {/* ── Subscriptions Table ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="bg-card border-border overflow-hidden py-0 gap-0">
            <CardHeader className="flex flex-row items-center gap-2 px-5 py-4 border-b border-border/60">
              <Layers className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm">Active Subscriptions</CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {subsQuery.isLoading && !subsQuery.isError ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Deployment</TableHead>
                        <TableHead>Runtime</TableHead>
                        <TableHead>Price/mo</TableHead>
                        <TableHead>LLM Usage</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Current Period</TableHead>
                        <TableHead className="w-[60px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[1, 2, 3].map((i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-6" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : subsQuery.isError ? (
                <div className="p-8 text-center">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive/50" />
                  <p className="text-sm text-muted-foreground">Failed to load subscriptions</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => subsQuery.refetch()}>Retry</Button>
                </div>
              ) : subs.length === 0 ? (
                <div className="py-12 text-center">
                  <Layers className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No active subscriptions</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Subscriptions appear here when you deploy a paid bot</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Deployment</TableHead>
                        <TableHead>Runtime</TableHead>
                        <TableHead>Price/mo</TableHead>
                        <TableHead>LLM Usage</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Current Period</TableHead>
                        <TableHead className="w-[60px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subs.map((sub: any) => (
                        <TableRow key={sub.deploymentId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{sub.deploymentName}</span>
                              {sub.llmMode === "included" && !sub.isLinked && (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] py-0 px-1.5">
                                  <Zap className="w-2.5 h-2.5 mr-0.5" />
                                  Managed Keys
                                </Badge>
                              )}
                              {sub.isLinked && (
                                <Badge variant="outline" className="bg-violet-500/10 text-violet-500 border-violet-500/20 text-[10px] py-0 px-1.5">
                                  <Link2 className="w-2.5 h-2.5 mr-0.5" />
                                  Linked
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{sub.runtime}</TableCell>
                          <TableCell>
                            <div>
                              <span>{formatCents(sub.monthlyPriceCents)}</span>
                              {sub.managedKeyCents > 0 && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  Hardware: {formatCents(sub.hardwareCents)} | LLM: {formatCents(sub.managedKeyCents)}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {sub.llmMode === "included" && !sub.isLinked ? (
                              <ManagedKeyUsageCell deploymentId={sub.deploymentId} limitDollars={sub.managedKeyPlanDollars} />
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>{statusBadge(sub.stripeStatus, sub.cancelledAt)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatPeriod(sub.periodStart, sub.periodEnd)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => router.push(`/d/${sub.deploymentId}/configure`)}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Invoice History ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="bg-card border-border overflow-hidden py-0 gap-0">
            <CardHeader className="flex flex-row items-center gap-2 px-5 py-4 border-b border-border/60">
              <Receipt className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm">Invoice History</CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {invoicesQuery.isLoading && !invoicesQuery.isError ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[60px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[1, 2, 3].map((i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-6" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : invoicesQuery.isError ? (
                <div className="p-8 text-center">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive/50" />
                  <p className="text-sm text-muted-foreground">Failed to load invoices</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => invoicesQuery.refetch()}>Retry</Button>
                </div>
              ) : invoices.length === 0 ? (
                <div className="py-12 text-center">
                  <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No invoices yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Invoices appear here after your first payment</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[60px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv: any) => (
                        <TableRow key={inv.id}>
                          <TableCell className="text-muted-foreground text-sm">
                            {formatDate(inv.date)}
                          </TableCell>
                          <TableCell className="font-medium">{inv.description}</TableCell>
                          <TableCell>{formatCents(inv.amountCents)}</TableCell>
                          <TableCell>{statusBadge(inv.status)}</TableCell>
                          <TableCell>
                            {inv.pdfUrl && (
                              <a
                                href={inv.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <FileText className="w-4 h-4" />
                              </a>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Manage Billing ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="p-5 bg-card border-border border-l-4 border-l-primary/20 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Stripe Billing Portal</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Update payment method, download invoices, or manage subscriptions
              </p>
            </div>
            <Button
              onClick={handleManageBilling}
              disabled={billingLoading}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium shrink-0 ml-4"
            >
              {billingLoading ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4 mr-1.5" />
              )}
              {billingLoading ? "Opening..." : "Manage Billing"}
            </Button>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
