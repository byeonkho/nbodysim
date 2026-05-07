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
  SCALE: {
    SEMI_REALISTIC: {
      name: "Semi-Realistic",
      positionScale: 4_000_000_000, // larger values scale the system down
      radiusScale: 100_000_000, // larger values scale radius down
      EXCEPTION_BODIES_POSITION_SCALE: {
        MOON: 15,
      },
      GRID: {
        SIZE: 3_650,
        SEGMENTS: 100,
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
      GRID: {
        SIZE: 148_250,
        SEGMENTS: 100,
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
