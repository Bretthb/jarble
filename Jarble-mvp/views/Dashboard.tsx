"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Sparkles,
  Bot,
  Send,
  Trash2,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import WizardLoader from "@/components/WizardLoader";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useState } from "react";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth0();
  const router = useRouter();

  const deploymentsQuery = trpc.deployment.list.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const canDeployQuery = trpc.deployment.canDeploy.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  const deleteDeploymentMutation = trpc.deployment.delete.useMutation({
    onSuccess: () => {
      toast.success("Deployment deleted");
      deploymentsQuery.refetch();
      canDeployQuery.refetch();
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to delete deployment");
    },
  });

  const handleCreateDeployment = () => {
    if (canDeployQuery.data && !canDeployQuery.data.allowed) {
      toast.error(
        `You've reached the limit of ${canDeployQuery.data.max} deployment${canDeployQuery.data.max === 1 ? '' : 's'} on the ${canDeployQuery.data.tierName} plan. Upgrade to create more.`
      );
      return;
    }
    router.push("/onboarding/new");
  };

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
          <p className="text-muted-foreground mb-4">Please log in to view your dashboard</p>
          <Button onClick={() => (window.location.href = "/login")}>
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const limits = canDeployQuery.data;
  const isAtLimit = limits ? !limits.allowed : false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <motion.div
            className="flex items-center gap-2 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            onClick={() => router.push("/")}
          >
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Sparkles className="w-6 h-6 text-primary" />
            </motion.div>
            <h1 className="text-xl font-serif font-bold">Jarble</h1>
          </motion.div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.name || "User"}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
              className="rounded-full border-input hover:bg-secondary/50"
            >
              Logout
            </Button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <h2 className="text-3xl font-bold mb-2">Your Deployments</h2>
            <p className="text-muted-foreground">Manage your AI deployments</p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            whileHover={{ scale: isAtLimit ? 1 : 1.05 }}
            whileTap={{ scale: isAtLimit ? 1 : 0.95 }}
          >
            <Button
              onClick={handleCreateDeployment}
              size="lg"
              disabled={isAtLimit}
              className={`rounded-full font-semibold shadow-lg ${
                isAtLimit
                  ? 'bg-muted text-muted-foreground cursor-not-allowed shadow-none'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/25'
              }`}
            >
              <Plus className="w-5 h-5 mr-2" />
              Create Deployment
            </Button>
          </motion.div>
        </div>

        {/* Tier Usage Banner */}
        {limits && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className={`rounded-lg border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
              isAtLimit
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-secondary/30 border-border'
            }`}>
              <div className="flex items-center gap-3">
                {isAtLimit && <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
                <div>
                  <p className="text-sm font-medium">
                    {limits.tierName} Plan — {limits.current}/{limits.max} deployment{limits.max === 1 ? '' : 's'} used
                  </p>
                  {isAtLimit && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      You&apos;ve reached your deployment limit. Upgrade to create more.
                    </p>
                  )}
                </div>
              </div>
              {isAtLimit && (
                <Button
                  size="sm"
                  onClick={() => router.push("/pricing")}
                  className="rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                >
                  Upgrade Plan
                  <ArrowUpRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* Deployments Grid */}
        {deploymentsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <WizardLoader
              messages={[
                "Gathering your deployments...",
                "Checking deployment status...",
                "Loading your creations...",
                "Almost there...",
              ]}
              size="lg"
            />
          </div>
        ) : deploymentsQuery.data && deploymentsQuery.data.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {deploymentsQuery.data.map((deployment: { id: string; name: string; status: string; template: string | null; description: string | null }) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                onDelete={(id) => {
                  deleteDeploymentMutation.mutate({ id });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Bot className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No deployments yet</h3>
            <p className="text-muted-foreground mb-4">Create your first deployment in under 2 minutes</p>
            <Button onClick={handleCreateDeployment}>
              Create Your First Deployment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Map API status values to display config
const STATUS_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  running: { bg: "bg-emerald-500/20", border: "border-emerald-500/50", text: "text-emerald-400", label: "Running" },
  creating: { bg: "bg-primary/20", border: "border-primary/50", text: "text-primary", label: "Creating" },
  pending: { bg: "bg-muted-foreground/20", border: "border-muted-foreground/50", text: "text-muted-foreground", label: "Pending" },
  failed: { bg: "bg-red-500/20", border: "border-red-500/50", text: "text-red-400", label: "Failed" },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { bg: "bg-muted-foreground/20", border: "border-muted-foreground/50", text: "text-muted-foreground", label: status };

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${config.bg} ${config.border}`}
    >
      <div
        className={`w-2 h-2 rounded-full ${config.text.replace("text-", "bg-")}`}
      />
      <span className={`text-xs font-semibold ${config.text}`}>{config.label}</span>
    </div>
  );
}

function DeploymentCard({ deployment, onDelete }: { deployment: { id: string; name: string; status: string; template: string | null; description: string | null }; onDelete: (id: string) => void }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="bg-card/80 backdrop-blur border-border hover:border-primary/30 transition-all overflow-hidden">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Bot className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-lg">{deployment.name}</h3>
                {deployment.template && (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                    <Send className="w-3 h-3" />
                    <span>{deployment.template}</span>
                  </div>
                )}
              </div>
            </div>
            <StatusBadge status={deployment.status} />
          </div>

          {deployment.description && (
            <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{deployment.description}</p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {deployment.status === "pending" ? (
              <Button
                size="sm"
                onClick={() => router.push(`/onboarding/${deployment.id}`)}
                className="flex-1 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                Complete Setup
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-border hover:bg-secondary hover:border-primary/50"
                onClick={() => router.push(`/d/${deployment.id}/configure`)}
              >
                Configure
              </Button>
            )}
            {confirmDelete ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { onDelete(deployment.id); setConfirmDelete(false); }}
                  className="text-xs"
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs border-border"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDelete(true)}
                className="border-border hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
