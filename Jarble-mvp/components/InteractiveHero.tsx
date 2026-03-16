"use client";

import { useRef, useEffect, useCallback, useState } from "react";

/**
 * Interactive hero with a living, breathing feel.
 *
 * - Video plays normally on loop
 * - Gentle idle floating animation (like breathing)
 * - Mouse proximity creates a magnetic pull effect
 * - Glow pulses and follows cursor
 * - Scroll adds depth with parallax layering
 */
export default function InteractiveHero() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const glowRingRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(Date.now());
  const [isHovering, setIsHovering] = useState(false);

  // Smooth lerped values
  const current = useRef({ rx: 0, ry: 0, tx: 0, ty: 0, glowX: 50, glowY: 50 });
  const target = useRef({ rx: 0, ry: 0, tx: 0, ty: 0, glowX: 50, glowY: 50 });
  const scrollY = useRef(0);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const el = wrapperRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Distance from center of element
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);

    // Proximity factor: stronger effect when closer
    const dist = Math.sqrt(dx * dx + dy * dy);
    const proximity = Math.max(0, 1 - dist * 0.4);

    target.current.rx = -dy * 8 * proximity;
    target.current.ry = dx * 8 * proximity;
    target.current.tx = dx * 15 * proximity;
    target.current.ty = dy * 10 * proximity;
    target.current.glowX = 50 + dx * 25;
    target.current.glowY = 50 + dy * 25;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    target.current = { rx: 0, ry: 0, tx: 0, ty: 0, glowX: 50, glowY: 50 };
  }, []);

  const handleScroll = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight;
    // 0 at center of viewport, positive when scrolled past
    scrollY.current = (viewH / 2 - (rect.top + rect.height / 2)) / viewH;
  }, []);

  const animate = useCallback(() => {
    const c = current.current;
    const t = target.current;
    const lerp = 0.06;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;

    // Lerp toward target
    c.rx += (t.rx - c.rx) * lerp;
    c.ry += (t.ry - c.ry) * lerp;
    c.tx += (t.tx - c.tx) * lerp;
    c.ty += (t.ty - c.ty) * lerp;
    c.glowX += (t.glowX - c.glowX) * lerp;
    c.glowY += (t.glowY - c.glowY) * lerp;

    // Idle breathing animation (always active, mouse adds on top)
    const breathX = Math.sin(elapsed * 0.8) * 3;
    const breathY = Math.cos(elapsed * 0.6) * 4;
    const breathRotate = Math.sin(elapsed * 0.4) * 1.5;

    // Scroll parallax (position only, no scale/fade)
    const scrollOffset = scrollY.current * -20;

    // Apply to video container
    if (videoRef.current) {
      videoRef.current.style.transform = [
        `perspective(900px)`,
        `rotateX(${c.rx + breathRotate}deg)`,
        `rotateY(${c.ry}deg)`,
        `translate3d(${c.tx + breathX}px, ${c.ty + breathY + scrollOffset}px, 0)`,
      ].join(" ");
    }

    // Animate glow
    if (glowRef.current) {
      const glowPulse = 0.2 + Math.sin(elapsed * 1.2) * 0.08;
      glowRef.current.style.background = `radial-gradient(circle at ${c.glowX}% ${c.glowY}%, hsl(var(--primary) / ${glowPulse}) 0%, transparent 55%)`;
    }

    // Animate outer ring
    if (glowRingRef.current) {
      const ringPulse = 0.06 + Math.sin(elapsed * 0.9 + 1) * 0.03;
      const ringScale = 1 + Math.sin(elapsed * 0.7) * 0.02;
      glowRingRef.current.style.transform = `scale(${ringScale})`;
      glowRingRef.current.style.opacity = `${ringPulse}`;
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    startTimeRef.current = Date.now();
    rafRef.current = requestAnimationFrame(animate);
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [animate, handleMouseMove, handleScroll]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full max-w-lg aspect-square flex items-center justify-center"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleMouseLeave}
    >
      {/* Glow and ring removed */}

      {/* Video with breathing + mouse tilt + scroll parallax */}
      <div
        ref={videoRef}
        className="relative w-full h-full"
        style={{
          willChange: "transform",
          transformStyle: "preserve-3d",
        }}
      >
        <video
          autoPlay
          muted
          playsInline
          preload="auto"
          className="relative w-full h-full object-contain"
          aria-label="Jarble thinker hero animation"
          poster="/hero-mobile.webp"
        >
          <source src="/hero-animation.webm" type="video/webm" />
        </video>
      </div>
    </div>
  );
}
