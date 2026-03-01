"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import CanvasRenderer from "../CanvasRenderer";

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
        <AccordionItem key={`${item.title}-${i}`} value={`item-${i}`}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            {item.content && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.content}</p>
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      {type === "single" ? (
        <Accordion type="single" defaultValue={defaultOpen[0]} collapsible>
          <AccordionItems items={items} />
        </Accordion>
      ) : (
        <Accordion type="multiple" defaultValue={defaultOpen}>
          <AccordionItems items={items} />
        </Accordion>
      )}
    </motion.div>
  );
}

export default memo(CanvasAccordionInner);
