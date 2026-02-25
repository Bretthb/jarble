"use client";

import dynamic from "next/dynamic";
import AntThemeProvider from "../AntThemeProvider";

const Carousel = dynamic(() => import("antd").then((m) => m.Carousel), {
  ssr: false,
  loading: () => (
    <div className="h-[250px] animate-pulse rounded bg-muted" />
  ),
});

export interface CanvasCarouselProps {
  items: { title?: string; description?: string; image?: string }[];
  autoplay?: boolean;
}

export default function CanvasCarousel({
  items,
  autoplay = false,
}: CanvasCarouselProps) {
  return (
    <AntThemeProvider>
      <div className="p-3 h-full">
        <Carousel autoplay={autoplay} dots>
          {items.map((item, i) => (
            <div key={i}>
              <div className="flex flex-col items-center justify-center gap-3 p-6 min-h-[200px]">
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.title || `Slide ${i + 1}`}
                    className="max-h-[150px] rounded-lg object-contain"
                  />
                )}
                {item.title && (
                  <h3 className="text-base font-semibold text-foreground">
                    {item.title}
                  </h3>
                )}
                {item.description && (
                  <p className="text-sm text-muted-foreground text-center max-w-md">
                    {item.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </Carousel>
      </div>
    </AntThemeProvider>
  );
}
