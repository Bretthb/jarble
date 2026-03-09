"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
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
  Settings,
  LogOut,
  Moon,
  Sun,
  User,
  LayoutDashboard,
  Layers,
  BarChart3,
  CreditCard,
  Store,
} from "lucide-react";

export default function ProfileDropdown() {
  const { user, logout } = useAuth0();
  const router = useRouter();
  const { theme, toggleTheme, switchable } = useTheme();

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
          <Avatar className="h-8 w-8 border border-border/60 hover:border-stone-400/50 transition-colors shadow-sm">
            <AvatarImage src={user?.picture} alt={user?.name || "User"} />
            <AvatarFallback className="text-xs font-medium bg-stone-700 text-stone-200">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user?.name || "User"}
            </p>
            <p className="text-xs text-muted-foreground leading-none truncate">
              {user?.email || ""}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/dashboard")}>
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </DropdownMenuItem>
          {/* TODO: Re-enable for post-MVP */}
          {/* <DropdownMenuItem onClick={() => router.push("/deployments")}>
            <Layers className="w-4 h-4" />
            Linked Deployments
          </DropdownMenuItem> */}
          {/* <DropdownMenuItem onClick={() => router.push("/marketplace")}>
            <Store className="w-4 h-4" />
            Marketplace
          </DropdownMenuItem> */}
          <DropdownMenuItem onClick={() => router.push("/analytics")}>
            <BarChart3 className="w-4 h-4" />
            Usage Analytics
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/billing")}>
            <CreditCard className="w-4 h-4" />
            Billing
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <User className="w-4 h-4" />
            Profile Settings
          </DropdownMenuItem>
          {switchable && toggleTheme && (
            <DropdownMenuItem onClick={toggleTheme}>
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
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            logout({ logoutParams: { returnTo: window.location.origin } })
          }
        >
          <LogOut className="w-4 h-4" />
          Log Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
