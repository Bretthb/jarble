"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Tree = dynamic(() => import("antd").then((m) => m.Tree), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded bg-muted" />,
});

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

export default function CanvasTree({
  data,
  title,
  defaultExpandAll = true,
}: CanvasTreeProps) {
  return (
    <AntThemeProvider>
      <div className="rounded-xl border border-border bg-card p-4">
        {title && (
          <h3 className="text-sm font-semibold text-foreground mb-3">
            {title}
          </h3>
        )}
        <Tree
          treeData={data}
          defaultExpandAll={defaultExpandAll}
          showLine
          showIcon={false}
        />
      </div>
    </AntThemeProvider>
  );
}
