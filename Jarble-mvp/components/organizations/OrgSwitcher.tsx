"use client";

import { useOrg } from "@/contexts/OrgContext";
import { Building2, Check, Plus, User } from "lucide-react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * Org switcher rendered inside ProfileDropdown.
 * Shows "Personal" + list of user's orgs with role badges.
 */
export default function OrgSwitcher({ onCreateOrg }: { onCreateOrg?: () => void }) {
  const { activeOrgId, setActiveOrgId, orgs, isLoading } = useOrg();

  if (isLoading) return null;

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
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => setActiveOrgId(org.id)}>
            <Building2 className="w-4 h-4" />
            <span className="flex-1 truncate">{org.name}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {org.role}
            </span>
            {activeOrgId === org.id && <Check className="w-3 h-3 text-primary ml-1" />}
          </DropdownMenuItem>
        ))}
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
