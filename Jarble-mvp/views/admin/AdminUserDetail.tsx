"use client";

import { use } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Loader2, ArrowLeft, Shield, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";

interface AdminUserDetailProps {
  params: Promise<{ id: string }>;
}

export default function AdminUserDetail({ params }: AdminUserDetailProps) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();

  const user = trpc.admin.getUserById.useQuery({ userId: id });
  const updateRole = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      utils.admin.getUserById.invalidate({ userId: id });
    },
  });

  if (user.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user.data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        User not found.
      </div>
    );
  }

  const u = user.data;
  const isSuperAdmin = u.role === "super_admin";

  function handleToggleRole() {
    const newRole = isSuperAdmin ? "user" : "super_admin";
    updateRole.mutate({ userId: id, role: newRole });
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/admin/users")}
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Users
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{u.name || u.email}</span>
            <Badge variant={isSuperAdmin ? "default" : "secondary"}>
              {u.role}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{u.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Joined</p>
              <p className="font-medium">
                {new Date(u.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <Button
            variant={isSuperAdmin ? "destructive" : "default"}
            size="sm"
            onClick={handleToggleRole}
            disabled={updateRole.isPending}
          >
            {updateRole.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : isSuperAdmin ? (
              <ShieldOff className="w-4 h-4 mr-1" />
            ) : (
              <Shield className="w-4 h-4 mr-1" />
            )}
            {isSuperAdmin ? "Revoke Admin" : "Grant Admin"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deployments</CardTitle>
        </CardHeader>
        <CardContent>
          {u.deployments && u.deployments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Runtime</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {u.deployments.map((dep) => (
                  <TableRow key={dep.id}>
                    <TableCell className="font-medium">{dep.name}</TableCell>
                    <TableCell>{dep.runtime}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{dep.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(dep.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No deployments.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
