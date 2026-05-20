import { StaticImageData } from "next/image";
import MercuryTexture from "../../../public/textures/mercury_texture.jpg";
import VenusTexture from "../../../public/textures/venus_texture.jpg";
import EarthTexture from "../../../public/textures/earth_texture.jpg";
import FallbackTexture from "../../../public/textures/earth_texture.jpg";
import MarsTexture from "../../../public/textures/mars_texture.jpg";
import JupiterTexture from "../../../public/textures/jupiter_texture.jpg";
import SaturnTexture from "../../../public/textures/saturn_texture.jpg";
import UranusTexture from "../../../public/textures/uranus_texture.jpg";
import NeptuneTexture from "../../../public/textures/neptune_texture.jpg";
import MoonTexture from "../../../public/textures/moon_texture.jpg";
import SunTexture from "../../../public/textures/sun_texture.jpg";

const SimConstants = {
  // 1 astronomical unit in metres (IAU 2012 definition). Scene grid cell
  // size is derived from AU_M so each cell is exactly 1 AU in world units,
  // regardless of the active scale preset.
  AU_M: 149_597_870_700,
  SCALE: {
    LOG: {
      name: "Log",
      preset: "log" as const,
      AXES: { SIZE: 150 }, // starting value — tuned in Phase 4 after the dev-mode tuning gate
    },
    REALISTIC: {
      name: "Realistic",
      preset: "realistic" as const,
      AXES: {
        SIZE: 80_000,
      },
    },
  },
  FPS: 60,
  MAX_SPEED_MULTIPLIER: 128, // exponent of 2
  // Minimum camera-to-active-body distance, expressed as a multiplier of
  // the body's currently rendered radius. 1.0 = touching the surface;
  // 2.5 = comfortable close-up where the body fills ~47° of the view at
  // a 50° FOV — close enough to see surface detail, far enough that the
  // surface doesn't engulf the entire viewport (which reads as clipping
  // even though the camera is technically outside the sphere). Coupled
  // to the scale toggle: rendered radius changes with the scale preset,
  // so Camera.tsx recomputes the minimum distance on scale change.
  CAMERA_MIN_DISTANCE_MULTIPLIER: 2.5,
  // Starfield sphere radius (drei <Stars/> in Scene.tsx). Hard ceiling
  // for camera zoom-out — past this, the user is outside the visible
  // universe and looking back at a tiny solar system in pure void.
  STARS_RADIUS: 100_000,
  // Maximum camera-to-target distance, expressed as a multiplier of the
  // active scale preset's AXES.SIZE (the visible-system half-extent).
  // 5× gives generous headroom to step back and see the whole system,
  // but Camera.tsx caps the result at STARS_RADIUS × 0.9 so the realistic
  // preset (AXES.SIZE = 80k → 5× = 400k) doesn't dolly past the stars.
  // Log preset (AXES.SIZE = 150 → 5× = 750) sits well under the cap.
  CAMERA_MAX_DISTANCE_MULTIPLIER: 5,
};

export interface BodyProperties {
  texture: StaticImageData;
  rotationSpeed: number; // radians/second, wall-clock time; negative = retrograde
}

export const bodyProperties: Record<string, BodyProperties> = {
  MERCURY: { texture: MercuryTexture as StaticImageData, rotationSpeed: 0.003 },
  VENUS:   { texture: VenusTexture   as StaticImageData, rotationSpeed: -0.002 },
  EARTH:   { texture: EarthTexture   as StaticImageData, rotationSpeed: 0.1 },
  MARS:    { texture: MarsTexture    as StaticImageData, rotationSpeed: 0.097 },
  JUPITER: { texture: JupiterTexture as StaticImageData, rotationSpeed: 0.24 },
  SATURN:  { texture: SaturnTexture  as StaticImageData, rotationSpeed: 0.22 },
  URANUS:  { texture: UranusTexture  as StaticImageData, rotationSpeed: -0.14 },
  NEPTUNE: { texture: NeptuneTexture as StaticImageData, rotationSpeed: 0.15 },
  MOON:    { texture: MoonTexture    as StaticImageData, rotationSpeed: 0.004 },
  SUN:     { texture: SunTexture     as StaticImageData, rotationSpeed: 0.004 },
  FALLBACK:{ texture: FallbackTexture as StaticImageData, rotationSpeed: 0.1 },
};

export default SimConstants;
