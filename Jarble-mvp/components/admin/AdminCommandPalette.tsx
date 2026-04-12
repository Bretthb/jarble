"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Users, Server, Building2, Ticket, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdminCommandPalette({ open, onOpenChange }: AdminCommandPaletteProps) {
  const router = useRouter();
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery.trim(), 150);

  useEffect(() => {
    if (!open) setRawQuery("");
  }, [open]);

  const results = trpc.admin.globalSearch.useQuery(
    { query, limitPerGroup: 5 },
    { enabled: query.length > 0, staleTime: 10_000 },
  );

  const navigate = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const hasResults =
    !!results.data &&
    (results.data.users.length +
      results.data.deployments.length +
      results.data.organizations.length +
      results.data.promoCodes.length) > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Admin search"
      description="Search users, deployments, organizations, and promo codes"
    >
      <CommandInput
        placeholder="Search users, deployments, orgs, promo codes..."
        value={rawQuery}
        onValueChange={setRawQuery}
      />
      <CommandList>
        {query.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Start typing to search across users, deployments, orgs, and promo codes.
          </div>
        )}

        {query.length > 0 && results.isLoading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching...
          </div>
        )}

        {query.length > 0 && !results.isLoading && !hasResults && (
          <CommandEmpty>No results for "{query}"</CommandEmpty>
        )}

        {results.data?.users.length ? (
          <CommandGroup heading="Users">
            {results.data.users.map((u) => (
              <CommandItem
                key={`user-${u.id}`}
                value={`user ${u.email} ${u.name ?? ""}`}
                onSelect={() => navigate(`/admin/users/${u.id}`)}
              >
                <Users className="w-4 h-4" />
                <span className="font-medium">{u.name || u.email}</span>
                {u.name && (
                  <span className="text-xs text-muted-foreground ml-2">{u.email}</span>
                )}
                {u.role === "super_admin" && (
                  <span className="ml-auto text-xs text-primary">admin</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results.data?.deployments.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Deployments">
              {results.data.deployments.map((d) => (
                <CommandItem
                  key={`dep-${d.id}`}
                  value={`deployment ${d.name} ${d.id}`}
                  onSelect={() => navigate(`/admin/deployments/${d.id}`)}
                >
                  <Server className="w-4 h-4" />
                  <span className="font-medium">{d.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{d.status}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results.data?.organizations.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Organizations">
              {results.data.organizations.map((o) => (
                <CommandItem
                  key={`org-${o.id}`}
                  value={`organization ${o.name}`}
                  onSelect={() => navigate(`/orgs/${o.id}`)}
                >
                  <Building2 className="w-4 h-4" />
                  <span className="font-medium">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {results.data?.promoCodes.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Promo codes">
              {results.data.promoCodes.map((p) => (
                <CommandItem
                  key={`promo-${p.id}`}
                  value={`promo ${p.code}`}
                  onSelect={() => navigate("/admin/promo")}
                >
                  <Ticket className="w-4 h-4" />
                  <span className="font-mono font-medium">{p.code}</span>
                  {!p.active && (
                    <span className="ml-auto text-xs text-muted-foreground">inactive</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
