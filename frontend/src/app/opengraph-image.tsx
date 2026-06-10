import { ImageResponse } from "next/og";

// Auto-wired by Next's file convention into the OpenGraph/Twitter card, so a
// shared link unfurls with a proper image. Generated at build time.

export const alt = "nbodysim, a real-time solar system simulator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Generate the card once at build time so it works under `output: 'export'`.
export const dynamic = "force-static";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#07080e",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              width: 104,
              height: 104,
              borderRadius: 9999,
              border: "4px solid #9298ee",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                background: "#c4c8ff",
              }}
            />
          </div>
          <div
            style={{
              marginLeft: 32,
              fontSize: 96,
              fontWeight: 700,
              color: "#e9eaf2",
            }}
          >
            nbodysim
          </div>
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 38,
            lineHeight: 1.35,
            color: "#a9adc4",
            maxWidth: 940,
          }}
        >
          Real-time simulation of the solar system, computed from real astronomy
          data and played back in 3D.
        </div>
      </div>
    ),
    size,
  );
}
