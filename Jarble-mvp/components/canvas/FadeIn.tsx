"use client";
import { type ReactNode, type HTMLAttributes } from "react";

interface FadeInProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  delay?: number;
}

/** Lightweight fade-in wrapper - replaces motion.div for simple entrance animations. ~0.5KB vs ~30KB for framer-motion. */
export function FadeIn({ children, className = "", delay = 0, style, ...rest }: FadeInProps) {
  return (
    <div
      className={`animate-fadeIn ${className}`}
      style={delay > 0 ? { ...style, animationDelay: `${delay}ms` } : style}
      {...rest}
    >
      {children}
    </div>
  );
}
