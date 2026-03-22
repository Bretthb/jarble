"use client";

/**
 * AgentCreditsPanel — shows credit balance, purchase tiers, and transaction history.
 *
 * Wired into the deployment page header toolbar with a Coins icon.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Coins,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ShoppingCart,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentCreditsPanelProps {
  onClose: () => void;
}

const REASON_ICONS: Record<string, typeof Coins> = {
  purchase: ShoppingCart,
  agent_call: ArrowUpRight,
  earnings: ArrowDownLeft,
  refund: RefreshCw,
};

const REASON_LABELS: Record<string, string> = {
  purchase: "Credit Purchase",
  agent_call: "Agent Call",
  earnings: "Earnings",
  refund: "Refund",
};

const TIER_OPTIONS = [
  { amount: "500" as const, label: "$5", credits: 500 },
  { amount: "2500" as const, label: "$20", credits: 2500 },
  { amount: "10000" as const, label: "$100", credits: 10000 },
];

export default function AgentCreditsPanel({ onClose }: AgentCreditsPanelProps) {
  const [showPurchase, setShowPurchase] = useState(false);

  const balanceQuery = trpc.agentCredits.getBalance.useQuery();
  const historyQuery = trpc.agentCredits.getHistory.useQuery({ limit: 20, offset: 0 });
  const purchaseMutation = trpc.agentCredits.purchaseCredits.useMutation({
    onSuccess: () => {
      balanceQuery.refetch();
      historyQuery.refetch();
      setShowPurchase(false);
    },
  });

  const balance = balanceQuery.data?.balance ?? 0;

  return (
    <div className="w-72 border-l border-border/60 bg-background flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium">Agent Credits</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Balance */}
      <div className="px-3 py-4 border-b border-border/60 text-center">
        <div className="text-3xl font-bold tabular-nums">
          {balanceQuery.isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto" />
          ) : (
            balance.toLocaleString()
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">credits available</div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setShowPurchase(!showPurchase)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Buy Credits
        </Button>
      </div>

      {/* Purchase tiers */}
      {showPurchase && (
        <div className="px-3 py-3 border-b border-border/60 space-y-2">
          <div className="text-xs font-medium text-muted-foreground mb-2">Select a tier</div>
          {TIER_OPTIONS.map((tier) => (
            <Button
              key={tier.amount}
              variant="outline"
              size="sm"
              className="w-full justify-between"
              disabled={purchaseMutation.isPending}
              onClick={() => purchaseMutation.mutate({ amount: tier.amount })}
            >
              <span>{tier.credits.toLocaleString()} credits</span>
              <span className="text-muted-foreground">{tier.label}</span>
            </Button>
          ))}
          {purchaseMutation.isPending && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing...
            </div>
          )}
          {purchaseMutation.isError && (
            <div className="text-xs text-destructive">
              {purchaseMutation.error.message}
            </div>
          )}
        </div>
      )}

      {/* Transaction history */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">Recent Transactions</div>
        </div>
        {historyQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : historyQuery.data?.entries.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No transactions yet.
            <br />
            Purchase credits to get started.
          </div>
        ) : (
          <div className="space-y-0.5">
            {historyQuery.data?.entries.map((entry: any) => {
              const Icon = REASON_ICONS[entry.reason] || Coins;
              const isPositive = entry.amount > 0;
              return (
                <div
                  key={entry.id}
                  className="px-3 py-2 flex items-center gap-2 hover:bg-muted/40 transition-colors"
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                      isPositive
                        ? "bg-green-500/10 text-green-600"
                        : "bg-red-500/10 text-red-600"
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {REASON_LABELS[entry.reason] || entry.reason}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "text-xs font-mono tabular-nums",
                      isPositive ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {isPositive ? "+" : ""}
                    {entry.amount}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
