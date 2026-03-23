"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";

export interface CanvasImageProps {
  src: string;
  alt?: string;
  caption?: string;
}

function CanvasImageInner({ src, alt, caption }: CanvasImageProps) {
  return (
    <FadeIn className="p-4 h-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || caption || ""}
        className="w-full max-h-80 object-contain bg-secondary/20"
        loading="lazy"
      />
      {caption && (
        <div className="px-3 py-2 bg-secondary/20">
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
      )}
    </FadeIn>
  );
}

export default memo(CanvasImageInner);
