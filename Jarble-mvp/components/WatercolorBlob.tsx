import { useMemo, useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/useMobile";

const BLOB_COLORS = ["#bfdbfe", "#ddd6fe", "#fbcfe8", "#99f6e4", "#c7d2fe"];

function generateBlobPositions(count: number) {
  return Array.from({ length: count }, () => ({
    top: `${Math.random() * 80}%`,
    left: `${Math.random() * 90}%`,
    width: `${120 + Math.random() * 200}px`,
    height: `${120 + Math.random() * 200}px`,
    borderRadius: `${60 + Math.random() * 20}% ${40 + Math.random() * 20}% ${50 + Math.random() * 20}% ${70 + Math.random() * 20}% / ${50 + Math.random() * 20}% ${60 + Math.random() * 20}% ${40 + Math.random() * 20}% ${60 + Math.random() * 20}%`,
    color: BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)],
    opacity: 0.45 + Math.random() * 0.05,
  }));
}

export default function WatercolorBlob() {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);

  // Fewer blobs on mobile for better performance (3 vs 6)
  const blobCount = isMobile ? 3 : 6;
  const blobs = useMemo(() => (mounted ? generateBlobPositions(blobCount) : []), [mounted, blobCount]);

  // Only generate blobs on the client to avoid hydration mismatch from Math.random()
  useEffect(() => setMounted(true), []);

  const blur = isMobile ? 40 : 80;
  const opacityMultiplier = isMobile ? 0.3 : 1;

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      style={{ contain: "strict" }}
      aria-hidden="true"
    >
      {blobs.map((blob, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: blob.top,
            left: blob.left,
            width: blob.width,
            height: blob.height,
            borderRadius: blob.borderRadius,
            backgroundColor: blob.color,
            opacity: blob.opacity * opacityMultiplier,
            filter: `blur(${blur}px)`,
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        />
      ))}
    </div>
  );
}
