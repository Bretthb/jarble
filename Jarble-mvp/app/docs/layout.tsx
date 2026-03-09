"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Rocket,
  Layers,
  Store,
  Code,
  Shield,
  Cpu,
  ArrowLeft,
  Menu,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import { useState } from "react";

const NAV_SECTIONS = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    description: "Quick start guide and first deployment",
  },
  {
    title: "Platform Guide",
    href: "/docs/platform",
    icon: BookOpen,
    description: "Deployments, runtimes, and configuration",
  },
  {
    title: "Components",
    href: "/docs/components",
    icon: Layers,
    description: "Canvas components and the UI system",
  },
  {
    title: "Marketplace",
    href: "/docs/marketplace",
    icon: Store,
    description: "Browse, publish, and install packages",
  },
  {
    title: "API Reference",
    href: "/docs/api",
    icon: Code,
    description: "tRPC endpoints and SSE streams",
  },
  {
    title: "Security",
    href: "/docs/security",
    icon: Shield,
    description: "Sandbox isolation, CSP, and encryption",
  },
  {
    title: "Architecture",
    href: "/docs/architecture",
    icon: Cpu,
    description: "System design and infrastructure",
  },
] as const;

function SidebarSearch() {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        placeholder="Search docs..."
        className="w-full rounded-md border border-input bg-transparent py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
      />
    </div>
  );
}

function SidebarNav({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1" aria-label="Documentation navigation">
      {NAV_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive =
          pathname === section.href || pathname?.startsWith(section.href + "/");

        return (
          <Link
            key={section.href}
            href={section.href}
            onClick={onLinkClick}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {section.title}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 py-4">
      <div className="px-4">
        <SidebarSearch />
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-4">
        <SidebarNav onLinkClick={onLinkClick} />
      </ScrollArea>
      <Separator />
      <div className="px-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Jarble
        </Link>
      </div>
    </div>
  );
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
          {isMobile && (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <SheetHeader className="px-4 pt-4">
                  <SheetTitle>Documentation</SheetTitle>
                </SheetHeader>
                <SidebarContent onLinkClick={() => setSheetOpen(false)} />
              </SheetContent>
            </Sheet>
          )}
          <div className="flex items-center gap-3">
            <Link href="/" className="font-serif font-bold text-lg tracking-tight">
              Jarble
            </Link>
            <Separator orientation="vertical" className="h-5" />
            <Link
              href="/docs"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Documentation
            </Link>
          </div>
          <div className="ml-auto">
            <Button variant="outline" size="sm" asChild>
              <Link href="/">Back to App</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Desktop Sidebar */}
        {!isMobile && (
          <aside className="sticky top-14 h-[calc(100vh-3.5rem)] w-[260px] shrink-0 border-r border-border">
            <SidebarContent />
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-[900px] px-6 py-10 lg:px-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
