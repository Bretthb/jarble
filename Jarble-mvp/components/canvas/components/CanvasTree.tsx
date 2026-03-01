"use client";

import { memo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronRight, ChevronDown } from "lucide-react";

export interface TreeNode {
  title: string;
  key: string;
  children?: TreeNode[];
}

export interface CanvasTreeProps {
  data: TreeNode[];
  title?: string;
  defaultExpandAll?: boolean;
}

function collectAllKeys(nodes: TreeNode[]): Set<string> {
  const keys = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      keys.add(node.key);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return keys;
}

function TreeNodeComponent({
  node,
  expandedKeys,
  onToggle,
  level,
}: {
  node: TreeNode;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  level: number;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedKeys.has(node.key);

  return (
    <div>
      <div
        className="flex items-center gap-1 py-1 hover:bg-muted/50 rounded-sm cursor-default"
        style={{ paddingLeft: `${level * 20}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.key)}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <span className="text-sm text-foreground">{node.title}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeComponent
              key={child.key}
              node={child}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CanvasTreeInner({
  data,
  title,
  defaultExpandAll = true,
}: CanvasTreeProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    defaultExpandAll ? collectAllKeys(data) : new Set()
  );

  const handleToggle = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {title}
        </h3>
      )}
      <div>
        {data.map((node) => (
          <TreeNodeComponent
            key={node.key}
            node={node}
            expandedKeys={expandedKeys}
            onToggle={handleToggle}
            level={0}
          />
        ))}
      </div>
    </motion.div>
  );
}

export default memo(CanvasTreeInner);
