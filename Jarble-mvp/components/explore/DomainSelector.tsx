"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

interface DomainSelectorProps {
  value: string;
  onChange: (slug: string) => void;
}

export function DomainSelector({ value, onChange }: DomainSelectorProps) {
  const domainsQuery = trpc.benchmarks.listDomains.useQuery(
    {},
    {
      retry: false,
      // Gracefully handle the endpoint not existing yet
      refetchOnWindowFocus: false,
    }
  );

  const domains = domainsQuery.data ?? [];

  if (domainsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground h-9 px-3">
        <Loader2 className="size-4 animate-spin" />
        Loading domains...
      </div>
    );
  }

  if (domainsQuery.isError || domains.length === 0) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="general">General</SelectItem>
          <SelectItem value="customer-support">Customer Support</SelectItem>
          <SelectItem value="coding">Coding</SelectItem>
          <SelectItem value="creative">Creative Writing</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select domain" />
      </SelectTrigger>
      <SelectContent>
        {domains.map((domain: { slug: string; name: string; icon?: string }) => (
          <SelectItem key={domain.slug} value={domain.slug}>
            <span className="flex items-center gap-2">
              {domain.icon && <span>{domain.icon}</span>}
              {domain.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
