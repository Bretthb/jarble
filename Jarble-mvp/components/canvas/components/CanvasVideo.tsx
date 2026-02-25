"use client";

import dynamic from "next/dynamic";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactPlayer: any = dynamic(() => import("react-player"), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded bg-muted" />,
});

export interface CanvasVideoProps {
  url: string;
  title?: string;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export default function CanvasVideo({
  url,
  title,
  controls = true,
  loop = false,
  muted = false,
}: CanvasVideoProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <div className="relative aspect-video overflow-hidden rounded-lg">
        <ReactPlayer
          url={url}
          controls={controls}
          loop={loop}
          muted={muted}
          width="100%"
          height="100%"
        />
      </div>
    </div>
  );
}
