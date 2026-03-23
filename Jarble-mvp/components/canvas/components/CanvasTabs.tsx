"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import CanvasRenderer from "../CanvasRenderer";
import { useCanvasAction } from "../CanvasActionContext";

interface TabChild {
  component: string;
  propsJson?: string;
  props?: Record<string, unknown>;
}

interface TabItem {
  label: string;
  content?: string;
  children?: TabChild[];
}

export interface CanvasTabsProps {
  tabs: TabItem[];
  defaultTab?: number;
}

function CanvasTabsInner({ tabs, defaultTab = 0 }: CanvasTabsProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider — interactivity disabled
  }

  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const defaultValue = `tab-${Math.min(defaultTab, tabs.length - 1)}`;

  const handleTabChange = (value: string) => {
    if (!dispatch) return;
    const index = parseInt(value.replace("tab-", ""), 10);
    const tab = tabs[index];
    if (tab) {
      dispatch({
        action: "tab_change",
        payload: { tab: tab.label, index },
      });
    }
  };

  return (
    <FadeIn
      className={[
        "overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      <Tabs defaultValue={defaultValue} onValueChange={handleTabChange} aria-label="Content tabs">
        {/* Custom TabsList styling */}
        <div className="px-4 pt-4 pb-0">
          <TabsList className="w-full bg-muted/50 dark:bg-white/[0.04] rounded-lg p-1 h-auto">
            {tabs.map((tab, i) => (
              <TabsTrigger
                key={`${tab.label}-${i}`}
                value={`tab-${i}`}
                className="data-[state=active]:shadow-sm data-[state=active]:bg-background/90 dark:data-[state=active]:bg-white/[0.08] rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* Gradient accent line below tabs */}
          <div className="mt-3 h-px w-full bg-gradient-to-r from-primary/20 via-border/30 to-transparent" />
        </div>

        {/* Tab content with fade transition */}
        {tabs.map((tab, i) => (
          <TabsContent key={`${tab.label}-${i}`} value={`tab-${i}`} className="px-4 pb-4 pt-3">
            <div>
              {tab.content && (
                <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">{tab.content}</p>
              )}
              {tab.children?.map((child, j) => {
                let resolvedProps: Record<string, unknown> = {};
                if (child.props) resolvedProps = child.props;
                else if (child.propsJson) {
                  try { resolvedProps = JSON.parse(child.propsJson); } catch { /* empty */ }
                }
                return (
                  <CanvasRenderer
                    key={`tab-${i}-child-${j}`}
                    block={{ id: `tab-${i}-child-${j}`, component: child.component, props: resolvedProps }}
                  />
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </FadeIn>
  );
}

export default memo(CanvasTabsInner);
