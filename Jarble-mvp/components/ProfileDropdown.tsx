"use client";

import { useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import { useOrg } from "@/contexts/OrgContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  BarChart3,
  Building2,
  CreditCard,
  LayoutDashboard,
  // Layers removed — Linked Deployments nav item removed
  LogOut,
  Moon,
  Settings,
  Shield,
  Store,
  Sun,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import OrgSwitcher from "@/components/organizations/OrgSwitcher";
import CreateOrgDialog from "@/components/organizations/CreateOrgDialog";

export default function ProfileDropdown() {
  const { user, logout } = useAuth0();
  const router = useRouter();
  const { theme, toggleTheme, switchable } = useTheme();
  const { isAdmin } = useIsAdmin();
  const { activeOrg } = useOrg();
  const [createOrgOpen, setCreateOrgOpen] = useState(false);

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform hover:scale-105 active:scale-95">
          <Avatar className="h-7 w-7 border border-border/60 hover:border-stone-400/50 transition-colors shadow-sm">
            <AvatarImage src={user?.picture} alt={user?.name || "User"} />
            <AvatarFallback className="text-xs font-medium bg-stone-700 text-stone-200">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Account header */}
        <DropdownMenuLabel className="font-normal py-1.5">
          <div className="flex flex-col space-y-0.5">
            <p className="text-sm font-medium leading-none">
              {user?.name || "User"}
            </p>
            <p className="text-xs text-muted-foreground leading-none truncate">
              {user?.email || ""}
            </p>
            {activeOrg && (
              <p className="text-xs text-primary leading-none mt-1 flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                {activeOrg.name}
              </p>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Workspace switcher */}
        <OrgSwitcher onCreateOrg={() => setCreateOrgOpen(true)} />

        {/* Navigation */}
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => router.push("/dashboard")} className="py-1.5 gap-1.5">
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </DropdownMenuItem>
          {/* Linked Deployments removed — now a tab on the dashboard */}
          <DropdownMenuItem onSelect={() => router.push("/marketplace")} className="py-1.5 gap-1.5">
            <Store className="w-4 h-4" />
            Marketplace
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onSelect={() => router.push("/admin")} className="py-1.5 gap-1.5">
              <Shield className="w-4 h-4" />
              Admin Dashboard
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => router.push("/analytics")} className="py-1.5 gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Usage Analytics
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/billing")} className="py-1.5 gap-1.5">
            <CreditCard className="w-4 h-4" />
            Billing
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Account & Org Management */}
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => router.push("/orgs")} className="py-1.5 gap-1.5">
            <Building2 className="w-4 h-4" />
            Manage Organizations
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/settings")} className="py-1.5 gap-1.5">
            <Settings className="w-4 h-4" />
            Settings
          </DropdownMenuItem>
          {switchable && toggleTheme && (
            <DropdownMenuItem onSelect={toggleTheme} className="py-1.5 gap-1.5 text-muted-foreground">
              {theme === "light" ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
              {theme === "light" ? "Dark Mode" : "Light Mode"}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {/* Logout */}
        <DropdownMenuItem
          variant="destructive"
          className="py-1.5 gap-1.5"
          onSelect={(e) => {
            e.preventDefault(); // Prevent radix from closing menu before logout completes
            logout({ logoutParams: { returnTo: window.location.origin } });
          }}
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
      <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </DropdownMenu>
  );
}
