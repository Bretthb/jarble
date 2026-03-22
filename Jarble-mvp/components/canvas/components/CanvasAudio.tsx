"use client";

import { memo } from "react";
import { motion } from "framer-motion";

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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <audio controls autoPlay={autoplay} className="w-full" aria-label={title || "Audio player"}>
        <source src={src} />
        Your browser does not support the audio element.
      </audio>
    </motion.div>
  );
}

export default memo(CanvasAudioInner);
