"use client";
import { AdminGuard } from "@/components/admin/AdminGuard";
import ProfileDropdown from "@/components/ProfileDropdown";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Server,
  Store,
  CreditCard,
  Activity,
  BarChart3,
  FileText,
  ArrowLeft,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/deployments", label: "Deployments", icon: Server },
  { href: "/admin/marketplace", label: "Marketplace", icon: Store },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
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

  return (
    <AdminGuard>
      <div className="min-h-screen">
        {/* Top navbar */}
        <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="px-4 sm:px-6 py-3 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="flex items-center gap-2 cursor-pointer no-underline text-foreground"
              >
                <span className="font-serif font-bold text-2xl tracking-tight">
                  Jarble
                </span>
              </a>
              <span className="text-border/80">|</span>
              <span className="text-sm font-medium text-muted-foreground">
                Admin
              </span>
            </div>
            <div className="flex items-center gap-3">
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
