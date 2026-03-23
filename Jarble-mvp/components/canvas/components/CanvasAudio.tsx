"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";

export interface CanvasAudioProps {
  src: string;
  title?: string;
  autoplay?: boolean;
}

function CanvasAudioInner({
  src,
  title,
  autoplay = false,
}: CanvasAudioProps) {
  return (
    <FadeIn className="p-4 h-full">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <audio controls autoPlay={autoplay} className="w-full" aria-label={title || "Audio player"}>
        <source src={src} />
        Your browser does not support the audio element.
      </audio>
    </FadeIn>
  );
}

export default memo(CanvasAudioInner);
