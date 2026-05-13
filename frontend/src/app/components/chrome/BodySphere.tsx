"use client";

import {
  type BodyKey,
  BODY_COLOR,
  bodyGradient,
} from "@/app/constants/BodyVisuals";

// Reusable body-color radial-gradient circle for UI chrome. Used by the
// body selector pills, body card header, ghost-label dots, mobile chip.

export interface BodySphereProps {
  body: BodyKey;
  size?: number;
  glow?: boolean;
  className?: string;
}

export function BodySphere({
  body,
  size = 14,
  glow = false,
  className,
}: BodySphereProps) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: bodyGradient(body),
        boxShadow: glow
          ? `0 0 ${Math.max(8, Math.round(size * 0.7))}px ${BODY_COLOR[body]}99`
          : "none",
        flexShrink: 0,
      }}
    />
  );
}
