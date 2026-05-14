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
  // size is derived as AU_M / positionScale so each cell is exactly 1 AU
  // in world units, regardless of the active scale preset.
  AU_M: 149_597_870_700,
  SCALE: {
    SEMI_REALISTIC: {
      name: "Semi-Realistic",
      positionScale: 4_000_000_000, // larger values scale the system down
      radiusScale: 100_000_000, // larger values scale radius down
      EXCEPTION_BODIES_POSITION_SCALE: {
        MOON: 15,
      },
      AXES: {
        SIZE: 2_000,
      },
    },
    REALISTIC: {
      name: "Realistic",
      positionScale: 100_000_000, // larger values scale the system down
      radiusScale: 100_000_000, // larger values scale radius down,
      EXCEPTION_BODIES_POSITION_SCALE: {
        MOON: 1,
      },
      AXES: {
        SIZE: 80_000,
      },
    },
  },
  FPS: 60,
  MAX_TIMESTEPS: 30_000,
  TIMESTEP_CHUNK_SIZE: 10_000,
  MAX_SPEED_MULTIPLIER: 128, // exponent of 2
  // Minimum camera-to-active-body distance, expressed as a multiplier of
  // the body's currently rendered radius. 1.0 = touching the surface;
  // 2.5 = comfortable close-up where the body fills ~47° of the view at
  // a 50° FOV — close enough to see surface detail, far enough that the
  // surface doesn't engulf the entire viewport (which reads as clipping
  // even though the camera is technically outside the sphere). Coupled
  // to the scale toggle: rendered radius depends on
  // simulationScale.radiusScale, so the actual minimum distance moves
  // with the scale preset (Camera.tsx recomputes on scale change).
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
  // Semi-Realistic (AXES.SIZE = 2k → 5× = 10k) sits well under the cap.
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
