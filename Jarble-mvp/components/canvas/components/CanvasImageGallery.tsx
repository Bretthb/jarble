"use client";

import { memo, useState } from "react";
import { FadeIn } from "../FadeIn";
import * as Dialog from "@radix-ui/react-dialog";

export interface CanvasImageGalleryProps {
  images: { src: string; alt?: string; caption?: string }[];
  title?: string;
  columns?: number;
}

function CanvasImageGalleryInner({
  images,
  title,
  columns = 3,
}: CanvasImageGalleryProps) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <FadeIn className="p-4 h-full">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <div
        aria-label={title || "Image gallery"}
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {images.map((img, i) => (
          <button
            key={`${img.src}-${i}`}
            onClick={() => setSelected(i)}
            className="overflow-hidden rounded-lg border border-border hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <img
              src={img.src}
              alt={img.alt || img.caption || `Image ${i + 1}`}
              className="w-full h-32 object-cover"
            />
            {img.caption && (
              <p className="text-xs text-muted-foreground p-1 truncate">
                {img.caption}
              </p>
            )}
          </button>
        ))}
      </div>

      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed inset-4 z-50 flex items-center justify-center focus:outline-none">
            <Dialog.Close className="absolute top-4 right-4 text-white text-2xl hover:opacity-70 z-10" aria-label="Close">
              ✕
            </Dialog.Close>
            {selected !== null && images[selected] && (
              <div className="max-w-4xl max-h-full flex flex-col items-center">
                <img
                  src={images[selected].src}
                  alt={images[selected].alt || images[selected].caption || ""}
                  className="max-w-full max-h-[80vh] object-contain rounded-lg"
                />
                {images[selected].caption && (
                  <p className="text-white text-sm mt-2">
                    {images[selected].caption}
                  </p>
                )}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </FadeIn>
  );
}

export default memo(CanvasImageGalleryInner);
