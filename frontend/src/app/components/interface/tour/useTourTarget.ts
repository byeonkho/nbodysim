import { useEffect, useState } from "react";

export interface TargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

// Resolves and tracks the viewport rect of the [data-tour="<target>"] element.
// Returns null for a centered step (target === null) or until the element is
// found. Re-measures on window resize and on the element's own resize; retries
// across a handful of animation frames so a target that mounts a beat after the
// step activates (the info card after an auto-select) is still picked up.
export function useTourTarget(target: string | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!target) {
      // Clearing DOM-derived state when the target goes away is a legitimate
      // external-system sync, not a render cascade (fires once per target
      // change, and centered steps ignore the rect anyway).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      return;
    }

    let frame = 0;
    let tries = 0;
    let ro: ResizeObserver | null = null;
    let el: HTMLElement | null = null;

    const measure = () => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        bottom: r.bottom,
        right: r.right,
      });
    };

    const attach = () => {
      el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (el) {
        measure();
        ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener("resize", measure);
        return;
      }
      // Not mounted yet — retry for ~30 frames (~0.5s) then give up.
      if (tries++ < 30) frame = requestAnimationFrame(attach);
      else setRect(null);
    };

    attach();

    return () => {
      cancelAnimationFrame(frame);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [target]);

  return rect;
}
