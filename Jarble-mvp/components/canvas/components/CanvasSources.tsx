"use client";

import React, { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasSourcesProps {
  items: Array<{
    title: string;
    url?: string;
    snippet?: string;
    icon?: string;
    relevance?: number;
  }>;
  title?: string;
}

function SourceRow({ item, index }: { item: CanvasSourcesProps["items"][number]; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group" role="listitem">
      <button
        onClick={() => item.snippet && setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 w-full text-left py-1.5 px-1 rounded-md transition-colors",
          item.snippet && "hover:bg-muted/50 cursor-pointer",
          !item.snippet && "cursor-default"
        )}
      >
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs font-medium text-muted-foreground shrink-0">
          {index + 1}
        </span>

        {item.icon && (
          <span className="text-sm shrink-0">{item.icon}</span>
        )}

        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-foreground/90 hover:underline truncate flex-1"
          >
            {item.title}
          </a>
        ) : (
          <span className="text-sm text-foreground/90 truncate flex-1">{item.title}</span>
        )}

        {item.relevance != null && (
          <div className="w-12 h-1.5 bg-muted rounded-full shrink-0 overflow-hidden">
            <div
              className="h-full bg-foreground/30 rounded-full"
              style={{ width: `${Math.round(item.relevance * 100)}%` }}
            />
          </div>
        )}

        {item.url && (
          <ExternalLink className="w-3 h-3 text-muted-foreground-subtle opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}

        {item.snippet && (
          <ChevronRight className={cn("w-3 h-3 text-muted-foreground-subtle transition-transform shrink-0", expanded && "rotate-90")} />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && item.snippet && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <p className="text-xs text-muted-foreground leading-relaxed pl-7 pr-2 pb-1.5 border-l-2 border-muted ml-3">
              {item.snippet}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CanvasSourcesInner({ items, title = "Sources" }: CanvasSourcesProps) {
  return (
    <motion.div
      role="list"
      aria-label={title}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-3 h-full"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        <span className="text-xs text-muted-foreground-subtle">({items.length})</span>
      </div>

      <div className="space-y-0.5">
        {items.map((item, i) => (
          <SourceRow key={i} item={item} index={i} />
        ))}
      </div>
    </motion.div>
  );
}

export default memo(CanvasSourcesInner);
