"use client";

export interface CanvasAudioProps {
  src: string;
  title?: string;
  autoplay?: boolean;
}

export default function CanvasAudio({
  src,
  title,
  autoplay = false,
}: CanvasAudioProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
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
