"use client";

import { memo } from "react";
import { motion } from "framer-motion";

export interface KeyValueItem {
  key: string;
  value: string | number;
}

export interface CanvasKeyValueProps {
  title?: string;
  items: KeyValueItem[];
}

function CanvasKeyValueInner({ title, items = [] }: CanvasKeyValueProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full space-y-2"
    >
      {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
      {items.map((item) => (
        <div key={item.key} className="flex justify-between items-baseline gap-4 py-1.5 border-b border-dotted border-border/40 last:border-0">
          <span className="text-xs text-muted-foreground shrink-0">{item.key}</span>
          <span className="text-sm text-foreground text-right">{String(item.value)}</span>
        </div>
      ))}
    </motion.div>
  );
}

export default memo(CanvasKeyValueInner);
