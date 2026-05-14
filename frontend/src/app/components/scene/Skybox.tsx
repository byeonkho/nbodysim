"use client";

import { useCallback } from "react";
import { useTexture } from "@react-three/drei";
import {
  EquirectangularReflectionMapping,
  SRGBColorSpace,
  Texture,
} from "three";
import { useDevSettings } from "@/app/dev/devSettingsStore";

// Deep-space skybox — equirectangular star map mounted directly on
// scene.background. Replaces drei <Stars/>: that produced visible
// twinkle on camera rotation because its size-attenuation formula
// (gl_PointSize = size * 30 / -mvPosition.z) collapses to sub-pixel
// values at our scene scale (radius 100k wu), and the GPU clamps to
// 1 px minimum — so every star rasterized at exactly 1 px and
// flickered between adjacent pixels as the projected center crossed
// pixel boundaries during orbit.
//
// The texture: NASA SVS Deep Star Maps 2020 — 1.7 billion stars
// from Hipparcos-2 + Tycho-2 + Gaia DR2, rendered in true visible
// light. Public domain (credit "NASA/Goddard SVS"). Sourced from
// https://svs.gsfc.nasa.gov/4851/ as 8K EXR (130MB), tone-mapped
// linear → sRGB and downsampled to 4096×2048 JPG q85 (~4MB).
//
// Three variants live in public/textures/skybox/:
//   - full     : default; full Milky Way + bright stars
//   - milkyway : Milky Way background only (no point stars)
//   - stars    : bright stars only (clean black + sparse)
//
// All three are pre-loaded eagerly via useTexture's object form so
// the dev panel can switch between them instantly with no Suspense
// flash. ~12 MB upfront cost, paid once and cached.
//
// Mapped via EquirectangularReflectionMapping (three.js's plate-carrée
// reader), tagged sRGB so the renderer linearises on sample then re-
// encodes on output. With Canvas tone-mapping disabled (flat prop on
// the parent), this preserves the source colors 1:1.

const VARIANT_PATHS = {
  full: "/textures/skybox/skybox-full.jpg",
  milkyway: "/textures/skybox/skybox-milkyway.jpg",
  stars: "/textures/skybox/skybox-stars.jpg",
} as const;

export function Skybox() {
  const { skyboxVariant } = useDevSettings();

  // onLoad fires once in a useLayoutEffect inside useTexture, before the
  // returned textures are consumed by render — the canonical drei seam
  // for setting non-default texture properties without violating React
  // 19's immutability rule. Object.values handles drei's runtime/type
  // mismatch (TS declares the callback receives a record matching the
  // input shape; runtime passes an array of those textures) — both
  // shapes produce iterable Texture instances, and mutations apply to
  // the same instances returned to the component.
  const onLoad = useCallback(
    (textures: Record<keyof typeof VARIANT_PATHS, Texture>) => {
      for (const t of Object.values(textures) as Texture[]) {
        t.mapping = EquirectangularReflectionMapping;
        t.colorSpace = SRGBColorSpace;
      }
    },
    [],
  );

  const textures = useTexture(VARIANT_PATHS, onLoad);

  return (
    <primitive attach="background" object={textures[skyboxVariant]} />
  );
}
