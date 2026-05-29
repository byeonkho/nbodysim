import { StaticImageData } from "next/image";
import MercuryTexture from "../../../public/textures/mercury_texture.jpg";
import VenusTexture from "../../../public/textures/venus_texture.jpg";
import EarthTexture from "../../../public/textures/earth_texture.jpg";
import FallbackTexture from "../../../public/textures/fallback.jpg";
import MarsTexture from "../../../public/textures/mars_texture.jpg";
import JupiterTexture from "../../../public/textures/jupiter_texture.jpg";
import SaturnTexture from "../../../public/textures/saturn_texture.jpg";
import UranusTexture from "../../../public/textures/uranus_texture.jpg";
import NeptuneTexture from "../../../public/textures/neptune_texture.jpg";
import MoonTexture from "../../../public/textures/moon_texture.jpg";
import SunTexture from "../../../public/textures/sun_texture.jpg";
// Minor bodies. Pallas / Hygiea / Apophis have no published surface mosaic
// (Pallas + Hygiea: only blurry Hubble discs; Apophis: radar-only until the
// 2029 flyby), so they ride the fallback texture. See ATTRIBUTIONS.md for
// licensing per asset.
import PlutoTexture from "../../../public/textures/pluto.jpg";
import CeresTexture from "../../../public/textures/ceres.jpg";
import VestaTexture from "../../../public/textures/vesta.jpg";
import ErosTexture from "../../../public/textures/eros.jpg";
import BennuTexture from "../../../public/textures/bennu.jpg";
import RyuguTexture from "../../../public/textures/ryugu.jpg";
// Moons (public-domain NASA/USGS mission mosaics — see ATTRIBUTIONS.md). Bodies
// with no usable public-domain mosaic (Deimos, Nereid) ride the fallback texture.
import PhobosTexture from "../../../public/textures/phobos.jpg";
import IoTexture from "../../../public/textures/io.jpg";
import EuropaTexture from "../../../public/textures/europa.jpg";
import GanymedeTexture from "../../../public/textures/ganymede.jpg";
import CallistoTexture from "../../../public/textures/callisto.jpg";
import EnceladusTexture from "../../../public/textures/enceladus.jpg";
import TethysTexture from "../../../public/textures/tethys.jpg";
import DioneTexture from "../../../public/textures/dione.jpg";
import RheaTexture from "../../../public/textures/rhea.jpg";
import TitanTexture from "../../../public/textures/titan.jpg";
import IapetusTexture from "../../../public/textures/iapetus.jpg";

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

  // Minor bodies. Rotation rates are stylized (same convention as the
  // planets above — visually-pleasing spin, not real angular velocity).
  // Negative = retrograde.
  PLUTO:   { texture: PlutoTexture   as StaticImageData, rotationSpeed: -0.016 }, // 6.4 d retrograde
  CERES:   { texture: CeresTexture   as StaticImageData, rotationSpeed:  0.045 }, // 9.07 hr
  VESTA:   { texture: VestaTexture   as StaticImageData, rotationSpeed:  0.076 }, // 5.34 hr
  PALLAS:  { texture: FallbackTexture as StaticImageData, rotationSpeed: 0.052 }, // 7.81 hr — fallback (no mosaic)
  HYGIEA:  { texture: FallbackTexture as StaticImageData, rotationSpeed: 0.029 }, // 13.8 hr — fallback (no mosaic)
  EROS:    { texture: ErosTexture    as StaticImageData, rotationSpeed:  0.076 }, // 5.27 hr
  APOPHIS: { texture: FallbackTexture as StaticImageData, rotationSpeed: 0.013 }, // 30.4 hr — fallback (no mosaic)
  BENNU:   { texture: BennuTexture   as StaticImageData, rotationSpeed:  0.093 }, // 4.30 hr
  RYUGU:   { texture: RyuguTexture   as StaticImageData, rotationSpeed:  0.053 }, // 7.63 hr

  // Moons. Stylized spins (cosmetic — real moons are tidally locked). Negative =
  // retrograde. Real rotation/orbital period in the trailing comment. Bodies on
  // the fallback texture (Deimos, Nereid) have no published public-domain mosaic.
  PHOBOS:  { texture: PhobosTexture  as StaticImageData, rotationSpeed:  0.08  }, // 0.319 d
  DEIMOS:  { texture: FallbackTexture as StaticImageData, rotationSpeed: 0.05  }, // 1.26 d — fallback (no PD mosaic)
  IO:       { texture: IoTexture       as StaticImageData, rotationSpeed:  0.05  }, // 1.77 d
  EUROPA:   { texture: EuropaTexture   as StaticImageData, rotationSpeed:  0.04  }, // 3.55 d
  GANYMEDE: { texture: GanymedeTexture as StaticImageData, rotationSpeed:  0.03  }, // 7.15 d
  CALLISTO: { texture: CallistoTexture as StaticImageData, rotationSpeed:  0.022 }, // 16.69 d
  MIMAS:    { texture: FallbackTexture as StaticImageData, rotationSpeed:  0.06  }, // 0.94 d — fallback (only gridded/airbrush PD maps)
  ENCELADUS:{ texture: EnceladusTexture as StaticImageData, rotationSpeed: 0.05  }, // 1.37 d
  TETHYS:   { texture: TethysTexture   as StaticImageData, rotationSpeed:  0.045 }, // 1.89 d
  DIONE:    { texture: DioneTexture    as StaticImageData, rotationSpeed:  0.04  }, // 2.74 d
  RHEA:     { texture: RheaTexture     as StaticImageData, rotationSpeed:  0.035 }, // 4.52 d
  TITAN:    { texture: TitanTexture    as StaticImageData, rotationSpeed:  0.024 }, // 15.95 d
  IAPETUS:  { texture: IapetusTexture  as StaticImageData, rotationSpeed:  0.014 }, // 79.3 d
};

export default SimConstants;
