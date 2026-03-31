"use client";

import { useEffect, useRef, memo } from "react";
import {
  Palette, Paintbrush, RotateCcw, Trash2, HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const COMMANDS: SlashCommand[] = [
  { command: "/theme", label: "/theme", description: "Change color preset", icon: <Palette className="w-4 h-4" /> },
  { command: "/skin", label: "/skin", description: "Change chat skin", icon: <Paintbrush className="w-4 h-4" /> },
  { command: "/reset", label: "/reset", description: "Reset theme to default", icon: <RotateCcw className="w-4 h-4" /> },
  { command: "/clear", label: "/clear", description: "Clear chat & canvas", icon: <Trash2 className="w-4 h-4" /> },
  { command: "/commands", label: "/commands", description: "Show all commands", icon: <HelpCircle className="w-4 h-4" /> },
];

interface SlashCommandMenuProps {
  query: string; // text after "/" - e.g. "th" for "/th"
  onSelect: (command: string) => void;
  onClose: () => void;
  selectedIndex: number;
}

function SlashCommandMenuInner({ query, onSelect, onClose, selectedIndex }: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = COMMANDS.filter((cmd) =>
    cmd.command.slice(1).startsWith(query.toLowerCase())
  );

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className={cn(
        "absolute bottom-full left-0 mb-1 w-72",
        "bg-popover border border-border rounded-lg shadow-lg",
        "overflow-hidden z-50",
        "animate-in fade-in slide-in-from-bottom-2 duration-150",
      )}
      role="listbox"
      aria-label="Slash commands"
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 border-b border-border/50">
        Commands
      </div>
      {filtered.map((cmd, i) => (
        <button
          key={cmd.command}
          role="option"
          aria-selected={i === selectedIndex}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2 text-left",
            "transition-colors duration-75",
            i === selectedIndex
              ? "bg-primary/10 text-foreground"
              : "text-foreground/80 hover:bg-secondary/50",
          )}
          onClick={() => onSelect(cmd.command)}
          onMouseDown={(e) => e.preventDefault()} // prevent textarea blur
        >
          <span className="text-muted-foreground shrink-0">{cmd.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{cmd.label}</div>
            <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export const SlashCommandMenu = memo(SlashCommandMenuInner);

/** Returns the number of filtered commands for a given query */
export function getFilteredCommandCount(query: string): number {
  return COMMANDS.filter((cmd) => cmd.command.slice(1).startsWith(query.toLowerCase())).length;
}
