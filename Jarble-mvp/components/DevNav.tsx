import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  Home,
  Info,
  DollarSign,
  LogIn,
  UserPlus,
  KeyRound,
  Wand2,
  Bot,
  LayoutDashboard,
  AlertCircle,
  Palette,
  Package,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Only render in development
const isDev = process.env.NODE_ENV === "development";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  category: "public" | "auth" | "app" | "dev";
  description?: string;
  requiresParam?: boolean;
}

const navItems: NavItem[] = [
  // Public pages
  {
    label: "Home",
    path: "/",
    icon: <Home className="w-4 h-4" />,
    category: "public",
    description: "Landing page",
  },
  {
    label: "About",
    path: "/about",
    icon: <Info className="w-4 h-4" />,
    category: "public",
    description: "About Jarble",
  },
  {
    label: "Pricing",
    path: "/pricing",
    icon: <DollarSign className="w-4 h-4" />,
    category: "public",
    description: "Pricing plans",
  },
  // TODO: Re-enable for post-MVP
  // {
  //   label: "Marketplace",
  //   path: "/marketplace",
  //   icon: <Package className="w-4 h-4" />,
  //   category: "public",
  //   description: "Component marketplace",
  // },
  // Auth pages
  {
    label: "Login",
    path: "/login",
    icon: <LogIn className="w-4 h-4" />,
    category: "auth",
    description: "Sign in",
  },
  {
    label: "Register",
    path: "/register",
    icon: <UserPlus className="w-4 h-4" />,
    category: "auth",
    description: "Create account",
  },
  {
    label: "Forgot Password",
    path: "/forgot-password",
    icon: <KeyRound className="w-4 h-4" />,
    category: "auth",
    description: "Reset password",
  },
  // App pages
  {
    label: "Dashboard",
    path: "/dashboard",
    icon: <LayoutDashboard className="w-4 h-4" />,
    category: "app",
    description: "Main dashboard",
  },
  {
    label: "Onboarding Wizard",
    path: "/onboarding/demo-bot",
    icon: <Wand2 className="w-4 h-4" />,
    category: "app",
    description: "Bot setup wizard",
    requiresParam: true,
  },
  {
    label: "Bot Configuration",
    path: "/bot/demo-bot/configure",
    icon: <Bot className="w-4 h-4" />,
    category: "app",
    description: "Configure bot settings",
    requiresParam: true,
  },
  // Dev pages
  {
    label: "Component Showcase",
    path: "/component-showcase",
    icon: <Palette className="w-4 h-4" />,
    category: "dev",
    description: "UI component library",
  },
  {
    label: "404 Page",
    path: "/404",
    icon: <AlertCircle className="w-4 h-4" />,
    category: "dev",
    description: "Not found page",
  },
];

const categoryLabels: Record<NavItem["category"], string> = {
  public: "Public Pages",
  auth: "Authentication",
  app: "App Pages",
  dev: "Dev Pages",
};

const categoryOrder: NavItem["category"][] = ["public", "auth", "app", "dev"];

export default function DevNav() {
  const [open, setOpen] = useState(false);
  const location = usePathname();

  // Don't render anything in production
  if (!isDev) {
    return null;
  }

  const groupedItems = categoryOrder.map((category) => ({
    category,
    label: categoryLabels[category],
    items: navItems.filter((item) => item.category === category),
  }));

  return (
    <div className="fixed bottom-3 right-16 z-[9999]">
        <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "h-9 w-9 rounded-full shadow-lg border-2",
              "bg-primary/90 hover:bg-primary border-primary",
              "text-primary-foreground hover:text-primary-foreground",
              "transition-all duration-200",
              open && "rotate-180"
            )}
            title="Dev Navigation"
          >
            {open ? (
              <X className="h-4 w-4" />
            ) : (
              <Wrench className="h-4 w-4" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-72 p-0 bg-card/95 backdrop-blur-md border-border"
          sideOffset={8}
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-foreground">Dev Navigation</h3>
              <Badge
                variant="secondary"
                className="ml-auto text-[10px] bg-primary/20 text-primary border-primary/30"
              >
                DEV ONLY
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Quick access to all pages
            </p>
          </div>
          
          <ScrollArea className="h-[400px]">
            <div className="p-2">
              {groupedItems.map((group, groupIndex) => (
                <div key={group.category}>
                  {groupIndex > 0 && <Separator className="my-2 bg-border" />}
                  <div className="px-2 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = location === item.path;
                      return (
                        <Link key={item.path} href={item.path}>
                          <button
                            onClick={() => setOpen(false)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left",
                              "transition-colors duration-150",
                              isActive
                                ? "bg-primary/20 text-primary"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            )}
                          >
                            <span
                              className={cn(
                                isActive ? "text-primary" : "text-muted-foreground"
                              )}
                            >
                              {item.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">
                                  {item.label}
                                </span>
                                {item.requiresParam && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 h-4 border-border text-muted-foreground"
                                  >
                                    :param
                                  </Badge>
                                )}
                              </div>
                              {item.description && (
                                <span className="text-[11px] text-muted-foreground truncate block">
                                  {item.description}
                                </span>
                              )}
                            </div>
                            {isActive && (
                              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            )}
                          </button>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="px-4 py-2 border-t border-border bg-secondary/30">
            <p className="text-[10px] text-muted-foreground text-center">
              Current: <code className="text-primary/80">{location}</code>
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
