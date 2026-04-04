"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { useOrg } from "@/contexts/OrgContext";
import { Building2, Plus, User, Crown, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ProfileDropdown from "@/components/ProfileDropdown";
import CreateOrgDialog from "@/components/organizations/CreateOrgDialog";

const ROLE_CONFIG = {
  owner: { icon: Crown, label: "Owner", color: "text-amber-500" },
  admin: { icon: ShieldCheck, label: "Admin", color: "text-blue-500" },
  member: { icon: User, label: "Member", color: "text-muted-foreground" },
} as const;

export default function OrgsListView() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth0();
  const { orgs, isLoading: orgsLoading } = useOrg();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  if (authLoading || orgsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    router.push("/login");
    return null;
  }

  // Sort: owned first, then admin, then member, then alphabetical
  const sortedOrgs = [...orgs].sort((a, b) => {
    const roleOrder = { owner: 0, admin: 1, member: 2 };
    const roleDiff = roleOrder[a.role] - roleOrder[b.role];
    if (roleDiff !== 0) return roleDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-serif font-medium">Organizations</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              Create Organization
            </Button>
            <ProfileDropdown />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {sortedOrgs.length === 0 ? (
          <Card className="p-12 text-center space-y-4">
            <Building2 className="w-12 h-12 text-muted-foreground mx-auto" />
            <div>
              <h2 className="text-lg font-medium">No organizations yet</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Create an organization to collaborate with your team on agents.
              </p>
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              Create your first organization
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedOrgs.map((org) => {
              const roleConfig = ROLE_CONFIG[org.role];
              const RoleIcon = roleConfig.icon;

              return (
                <Card
                  key={org.id}
                  className="p-5 cursor-pointer hover:border-primary/40 transition-colors group"
                  onClick={() => router.push(`/orgs/${org.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <Building2 className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium truncate group-hover:text-primary transition-colors">
                          {org.name}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate">
                          {org.slug}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-1.5">
                    <RoleIcon className={`w-3.5 h-3.5 ${roleConfig.color}`} />
                    <span className="text-xs text-muted-foreground">
                      {roleConfig.label}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <CreateOrgDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
