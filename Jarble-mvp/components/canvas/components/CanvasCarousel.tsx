"use client";

import { memo, useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CanvasCarouselProps {
  items: { title?: string; description?: string; image?: string }[];
  autoplay?: boolean;
}

function CanvasCarouselInner({
  items,
  autoplay = false,
}: CanvasCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goToPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1));
  }, [items.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
  }, [items.length]);

  useEffect(() => {
    if (autoplay && items.length > 1) {
      intervalRef.current = setInterval(goToNext, 4000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [autoplay, items.length, goToNext]);

  if (items.length === 0) return null;

  const currentItem = items[currentIndex];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      <div className="relative" role="region" aria-label="Carousel" aria-roledescription="carousel">
        {/* Slide content */}
        <div className="flex flex-col items-center justify-center gap-3 p-6 min-h-[200px]">
          {currentItem.image && (
            <img
              src={currentItem.image}
              alt={currentItem.title || `Slide ${currentIndex + 1}`}
              className="max-h-[150px] rounded-lg object-contain"
            />
          )}
          {currentItem.title && (
            <h3 className="text-base font-semibold text-foreground">
              {currentItem.title}
            </h3>
          )}
          {currentItem.description && (
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {currentItem.description}
            </p>
          )}
        </div>

        {/* Navigation buttons */}
        {items.length > 1 && (
          <>
            <button
              onClick={goToPrev}
              className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-muted/80 hover:bg-muted text-foreground transition-colors"
              aria-label="Previous slide"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToNext}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-muted/80 hover:bg-muted text-foreground transition-colors"
              aria-label="Next slide"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Dot indicators */}
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {items.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-6 h-6 rounded-full transition-colors ${
                index === currentIndex
                  ? "bg-primary"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default memo(CanvasCarouselInner);
