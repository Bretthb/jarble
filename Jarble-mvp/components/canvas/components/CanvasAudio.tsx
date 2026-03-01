"use client";

import { memo } from "react";

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
    <div className="p-3 h-full">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <audio controls autoPlay={autoplay} className="w-full">
        <source src={src} />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

export default memo(CanvasAudioInner);
