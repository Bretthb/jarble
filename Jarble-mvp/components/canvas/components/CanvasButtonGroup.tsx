"use client";

import { memo, useState } from "react";
import { useCanvasAction } from "../CanvasActionContext";

interface ButtonDef {
  id: string;
  label: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
  icon?: string;
  disabled?: boolean;
}

export interface CanvasButtonGroupProps {
  buttons: ButtonDef[];
}

const VARIANT_STYLES: Record<string, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
  destructive: "bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30",
  outline: "bg-transparent text-foreground hover:bg-secondary border border-border",
};

function CanvasButtonGroupInner({ buttons }: CanvasButtonGroupProps) {
  const { dispatch } = useCanvasAction();
  const [clicked, setClicked] = useState<string | null>(null);

  if (!Array.isArray(buttons) || buttons.length === 0) return null;

  const handleClick = (buttonId: string) => {
    setClicked(buttonId);
    dispatch({ action: "click", payload: { buttonId } });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((btn) => {
        const isDisabled = btn.disabled || clicked !== null;
        const isClicked = clicked === btn.id;
        const style = VARIANT_STYLES[btn.variant || "default"] || VARIANT_STYLES.default;

        return (
          <button
            key={btn.id}
            onClick={() => handleClick(btn.id)}
            disabled={isDisabled}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${style} ${
              isClicked ? "ring-2 ring-primary/30" : ""
            }`}
          >
            {btn.icon && <span>{btn.icon}</span>}
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}

export default memo(CanvasButtonGroupInner);
