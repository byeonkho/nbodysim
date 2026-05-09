"use client";

import { useEffect, useRef } from "react";

// Self-contained FPS readout. Maintains a requestAnimationFrame loop
// and writes the value to its own DOM ref so parent components don't
// rerender at frame rate. Sampling window: 250 ms.

const SAMPLE_MS = 250;

export function FpsValue({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      frames++;
      const elapsed = now - last;
      if (elapsed >= SAMPLE_MS) {
        const fps = Math.round((frames * 1000) / elapsed);
        if (ref.current) ref.current.textContent = String(fps);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span ref={ref} className={className}>
      —
    </span>
  );
}
