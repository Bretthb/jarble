"use client";

import { memo } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import CanvasRenderer from "../CanvasRenderer";
import { FadeIn } from "../FadeIn";

interface AccordionChild {
  component: string;
  propsJson?: string;
  props?: Record<string, unknown>;
}

interface AccordionItemDef {
  title: string;
  content?: string;
  children?: AccordionChild[];
  defaultOpen?: boolean;
}

export interface CanvasAccordionProps {
  items: AccordionItemDef[];
  type?: "single" | "multiple";
}

function AccordionItems({ items }: { items: AccordionItemDef[] }) {
  return (
    <>
      {items.map((item, i) => (
        <FadeIn
          key={`${item.title}-${i}`}
          delay={i * 50}
        >
          <AccordionItem
            value={`item-${i}`}
            className="border-border/30 last:border-0 group/item"
          >
            <AccordionTrigger className="hover:no-underline hover:bg-muted/30 dark:hover:bg-white/[0.03] px-4 py-3 text-sm transition-colors duration-200 [&[data-state=open]]:bg-muted/10 dark:[&[data-state=open]]:bg-white/[0.02]">
              <span className="flex items-center gap-2">
                {/* Left accent bar for open state */}
                <span className="w-[2px] h-4 rounded-full bg-primary/60 opacity-0 group-data-[state=open]/item:opacity-100 transition-opacity duration-200 shrink-0" />
                {item.title}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-1">
              {item.content && (
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{item.content}</p>
              )}
              {item.children && (
                <div className="space-y-2 mt-2">
                  {item.children.map((child, j) => {
                    let resolvedProps: Record<string, unknown> = {};
                    if (child.props) resolvedProps = child.props;
                    else if (child.propsJson) {
                      try { resolvedProps = JSON.parse(child.propsJson); } catch { /* empty */ }
                    }
                    return (
                      <CanvasRenderer
                        key={`acc-${i}-child-${j}`}
                        block={{ id: `acc-${i}-child-${j}`, component: child.component, props: resolvedProps }}
                      />
                    );
                  })}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </FadeIn>
      ))}
    </>
  );
}

function CanvasAccordionInner({ items, type = "multiple" }: CanvasAccordionProps) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const defaultOpen = items
    .map((item, i) => (item.defaultOpen ? `item-${i}` : null))
    .filter(Boolean) as string[];

  return (
    <FadeIn
      className={[
        "overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm dark:shadow-md dark:shadow-black/15",
      ].join(" ")}
    >
      {type === "single" ? (
        <Accordion type="single" defaultValue={defaultOpen[0]} collapsible aria-label="Expandable sections">
          <AccordionItems items={items} />
        </Accordion>
      ) : (
        <Accordion type="multiple" defaultValue={defaultOpen} aria-label="Expandable sections">
          <AccordionItems items={items} />
        </Accordion>
      )}
    </FadeIn>
  );
}

export default memo(CanvasAccordionInner);
