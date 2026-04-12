"use client";
import { useEffect, useState } from "react";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
import ProfileDropdown from "@/components/ProfileDropdown";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import {
  LayoutDashboard,
  Users,
  Server,
  Store,
  CreditCard,
  Activity,
  BarChart3,
  FileText,
  Ticket,
  ArrowLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/deployments", label: "Deployments", icon: Server },
  { href: "/admin/marketplace", label: "Marketplace", icon: Store },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/promo", label: "Promo Codes", icon: Ticket },
  { href: "/admin/system", label: "System", icon: Activity },
  { href: "/admin/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/admin/audit", label: "Audit Logs", icon: FileText },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme } = useTheme();
  const logoSrc = theme === "dark" ? "/logodark.png" : "/logo.png";
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <AdminGuard>
      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="min-h-screen">
        {/* Top navbar */}
        <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="px-4 sm:px-6 py-3 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="flex items-center gap-2 cursor-pointer no-underline text-foreground"
              >
                <Image src={logoSrc} alt="Jarble" width={120} height={36} className="h-12 w-auto" />
              </a>
              <span className="text-border/80">|</span>
              <span className="text-sm font-medium text-muted-foreground">
                Admin
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border/60 hover:border-border transition-colors"
                title="Open search (Ctrl+K)"
              >
                Search...
                <kbd className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  Ctrl K
                </kbd>
              </button>
              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Dashboard
              </Link>
              <ProfileDropdown />
            </div>
          </div>
        </nav>

        <div className="flex" style={{ minHeight: "calc(100vh - 57px)" }}>
          {/* Sidebar */}
          <aside className="w-60 border-r border-border bg-card/50 p-3 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </aside>

          {/* Main content */}
          <main className="flex-1 p-6 overflow-auto">{children}</main>
        </div>
      </div>
    </AdminGuard>
  );
}
