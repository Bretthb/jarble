"use client";

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

export default function CanvasTabs({ tabs, defaultTab = 0 }: CanvasTabsProps) {
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
    <div className="p-3 h-full">
      <Tabs defaultValue={defaultValue} onValueChange={handleTabChange}>
        <TabsList>
          {tabs.map((tab, i) => (
            <TabsTrigger key={i} value={`tab-${i}`}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab, i) => (
          <TabsContent key={i} value={`tab-${i}`}>
            {tab.content && (
              <p className="text-sm text-foreground whitespace-pre-wrap">{tab.content}</p>
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
