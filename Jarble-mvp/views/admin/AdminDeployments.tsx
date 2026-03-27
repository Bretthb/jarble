"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Play,
  Square,
  RotateCw,
  Trash2,
} from "lucide-react";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "running", label: "Running" },
  { value: "stopped", label: "Stopped" },
  { value: "creating", label: "Creating" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  stopped: "secondary",
  creating: "outline",
  failed: "destructive",
  pending: "outline",
};

export default function AdminDeployments() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const utils = trpc.useUtils();

  const deployments = trpc.admin.listAllDeployments.useQuery({
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
    search: search || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const startMutation = trpc.admin.adminStartDeployment.useMutation({
    onSuccess: () => utils.admin.listAllDeployments.invalidate(),
  });
  const stopMutation = trpc.admin.adminStopDeployment.useMutation({
    onSuccess: () => utils.admin.listAllDeployments.invalidate(),
  });
  const restartMutation = trpc.admin.adminRestartDeployment.useMutation({
    onSuccess: () => utils.admin.listAllDeployments.invalidate(),
  });
  const deleteMutation = trpc.admin.adminDeleteDeployment.useMutation({
    onSuccess: () => utils.admin.listAllDeployments.invalidate(),
  });

  const totalPages = Math.ceil((deployments.data?.total ?? 0) / PAGE_SIZE);

  function handleAction(
    action: "start" | "stop" | "restart" | "delete",
    deploymentId: string,
  ) {
    if (action === "delete") {
      if (!window.confirm("Are you sure you want to delete this deployment?")) {
        return;
      }
    }
    const mutations = {
      start: startMutation,
      stop: stopMutation,
      restart: restartMutation,
      delete: deleteMutation,
    };
    mutations[action].mutate({ deploymentId });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Deployments</h1>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 max-w-sm flex-1">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or owner..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(val) => {
            setStatusFilter(val);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {deployments.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Runtime</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.data?.deployments.map((dep) => (
                <TableRow key={dep.id}>
                  <TableCell className="font-medium">{dep.name}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p>{dep.userName || " - "}</p>
                      <p className="text-muted-foreground text-xs">
                        {dep.userEmail}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>{dep.runtime}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[dep.status] ?? "outline"}>
                      {dep.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(dep.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Start"
                        onClick={() => handleAction("start", dep.id)}
                        disabled={startMutation.isPending}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Stop"
                        onClick={() => handleAction("stop", dep.id)}
                        disabled={stopMutation.isPending}
                      >
                        <Square className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Restart"
                        onClick={() => handleAction("restart", dep.id)}
                        disabled={restartMutation.isPending}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title="Delete"
                        onClick={() => handleAction("delete", dep.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {deployments.data?.deployments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    No deployments found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {deployments.data?.total ?? 0} total deployments
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {Math.max(1, totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
