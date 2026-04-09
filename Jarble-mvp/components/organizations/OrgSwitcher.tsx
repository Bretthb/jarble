"use client";

import { useOrg } from "@/contexts/OrgContext";
import { Building2, Check, Plus, User, ChevronsUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const MAX_INLINE_ORGS = 5;

/**
 * Org switcher rendered inside ProfileDropdown.
 * Shows "Personal" + up to 5 orgs inline. If more than 5, shows "View all orgs".
 * Active org is always pinned at the top.
 */
export default function OrgSwitcher({ onCreateOrg }: { onCreateOrg?: () => void }) {
  const { activeOrgId, setActiveOrgId, orgs, isLoading } = useOrg();
  const router = useRouter();

  if (isLoading) return null;

  // Pin active org at top, then the rest
  const activeOrg = orgs.find((o) => o.id === activeOrgId);
  const otherOrgs = orgs.filter((o) => o.id !== activeOrgId);
  const visibleOrgs = activeOrg
    ? [activeOrg, ...otherOrgs.slice(0, MAX_INLINE_ORGS - 1)]
    : otherOrgs.slice(0, MAX_INLINE_ORGS);
  const hasOverflow = orgs.length > MAX_INLINE_ORGS;

  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
        Workspace
      </DropdownMenuLabel>
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={() => setActiveOrgId(null)}>
          <User className="w-4 h-4" />
          <span className="flex-1">Personal</span>
          {activeOrgId === null && <Check className="w-3 h-3 text-primary" />}
        </DropdownMenuItem>
        {visibleOrgs.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => setActiveOrgId(org.id)}>
            <Building2 className="w-4 h-4" />
            <span className="flex-1 truncate">{org.name}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {org.role}
            </span>
            {activeOrgId === org.id && <Check className="w-3 h-3 text-primary ml-1" />}
          </DropdownMenuItem>
        ))}
        {hasOverflow && (
          <DropdownMenuItem onClick={() => router.push("/orgs")}>
            <ChevronsUpDown className="w-4 h-4" />
            <span className="flex-1 text-muted-foreground">
              View all {orgs.length} orgs
            </span>
          </DropdownMenuItem>
        )}
        {onCreateOrg && (
          <DropdownMenuItem onClick={onCreateOrg}>
            <Plus className="w-4 h-4" />
            Create Organization
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
    </>
  );
}
