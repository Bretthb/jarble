"use client";

import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
} from "lucide-react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
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
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500">
        Cancelling
      </span>
    );
  }
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
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground capitalize">
          {status}
        </span>
      );
  }
}

function invoiceStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500">
          Paid
        </span>
      );
    case "open":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500">
          Open
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
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Monthly Spend</span>
            </div>
            {!overviewSettled ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <p className="text-2xl font-bold">{formatCents(overview?.totalMonthlyCents ?? 0)}</p>
            )}
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Active Subscriptions</span>
            </div>
            {!overviewSettled ? (
              <Skeleton className="h-7 w-10 mt-1" />
            ) : (
              <p className="text-2xl font-bold">{overview?.activeSubscriptionCount ?? 0}</p>
            )}
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Receipt className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Next Payment</span>
            </div>
            {overviewQuery.isLoading ? (
              <Skeleton className="h-7 w-28 mt-1" />
            ) : (
              <p className="text-2xl font-bold">
                {overview?.nextBillingDate ? formatDate(overview.nextBillingDate) : <span className="text-muted-foreground">—</span>}
              </p>
            )}
          </Card>

          <Card className="p-5 bg-card border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Payment Method</span>
            </div>
            {overviewQuery.isLoading ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <p className="text-2xl font-bold">
                {overview?.paymentMethodLast4 ? (
                  <span className="text-lg">···· {overview.paymentMethodLast4}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            )}
          </Card>
        </motion.div>

        {/* ── Subscriptions Table ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="bg-card border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-base">Active Subscriptions</h2>
            </div>

            {subsQuery.isLoading && !subsQuery.isError ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-28 ml-auto" />
                  </div>
                ))}
              </div>
            ) : subsQuery.isError ? (
              <div className="p-8 text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive/50" />
                <p className="text-sm text-muted-foreground">Failed to load subscriptions</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => subsQuery.refetch()}>Retry</Button>
              </div>
            ) : subs.length === 0 ? (
              <div className="p-8 text-center">
                <Layers className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground mb-3">No active subscriptions</p>
                <Button variant="outline" size="sm" onClick={() => router.push("/onboarding/new")}>
                  Create a Deployment
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deployment</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Price/mo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current Period</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((sub: any) => (
                    <TableRow key={sub.deploymentId}>
                      <TableCell className="font-medium">{sub.deploymentName}</TableCell>
                      <TableCell className="text-muted-foreground">{sub.runtime}</TableCell>
                      <TableCell>{formatCents(sub.monthlyPriceCents)}</TableCell>
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
                          aria-label="Open deployment configuration"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </motion.div>

        {/* ── Invoice History ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="bg-card border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-base">Invoice History</h2>
            </div>

            {invoicesQuery.isLoading && !invoicesQuery.isError ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                ))}
              </div>
            ) : invoicesQuery.isError ? (
              <div className="p-8 text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive/50" />
                <p className="text-sm text-muted-foreground">Failed to load invoices</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => invoicesQuery.refetch()}>Retry</Button>
              </div>
            ) : invoices.length === 0 ? (
              <div className="p-8 text-center">
                <Receipt className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No invoices yet — invoices appear after your first billing cycle</p>
              </div>
            ) : (
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
                      <TableCell>{invoiceStatusBadge(inv.status)}</TableCell>
                      <TableCell>
                        {inv.pdfUrl && (
                          <a
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            aria-label="Download invoice PDF"
                          >
                            <FileText className="w-4 h-4" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </motion.div>

        {/* ── Manage Billing ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="p-5 bg-card border-border flex items-center justify-between">
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
