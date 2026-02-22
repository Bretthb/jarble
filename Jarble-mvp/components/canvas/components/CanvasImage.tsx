"use client";

export interface CanvasImageProps {
  src: string;
  alt?: string;
  caption?: string;
}

export default function CanvasImage({ src, alt, caption }: CanvasImageProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || ""}
        className="w-full max-h-80 object-contain bg-secondary/20"
        loading="lazy"
      />
      {caption && (
        <div className="px-4 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
      )}
    </div>
  );
}
