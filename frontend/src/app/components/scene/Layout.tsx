"use client";

import React, { useEffect, useState } from "react";

import Scene from "@/app/components/scene/Scene";
import UpdateModal from "@/app/components/interface/misc/UpdateModal";
import { BodySelector } from "@/app/components/chrome/BodySelector";
import { FrameCompass } from "@/app/components/chrome/FrameCompass";
import { LeftRail } from "@/app/components/chrome/LeftRail";
import { RightColumn } from "@/app/components/chrome/RightColumn";
import { SimParamsDialog } from "@/app/components/chrome/SimParamsDialog";
import { Timeline } from "@/app/components/chrome/Timeline";
import { TopStatusStrip } from "@/app/components/chrome/TopStatusStrip";
import { DevPanel } from "@/app/components/dev/DevPanel";

const Layout: React.FC = () => {
  const [simParamsOpen, setSimParamsOpen] = useState(false);
  const [devMode, setDevMode] = useState(false);

  // Read ?dev=1 once on mount. The dev panel is gated rather than
  // built into the user-facing chrome, so the gate doesn't need to
  // re-evaluate mid-session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setDevMode(params.has("dev"));
  }, []);

  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <div className="grow relative overflow-hidden">
        {/* Background rendered in CSS — not via three.js scene.background.
            The Canvas inside <Scene /> is transparent (gl.alpha=true), so
            this gradient stack shows through. Lifted verbatim from the
            design handoff's `.starfield` CSS (frontend/design_handoff_
            spacesim_ui/index.html): inky `#050610` base with two soft
            elliptical glows. Going via CSS rather than canvas-texture
            sidesteps three.js's color pipeline entirely (no sRGB
            double-encoding, no tone-mapping interactions), so the
            rendered background is pixel-identical to the design mockup
            since the browser renders both. */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `
              radial-gradient(ellipse at 60% 35%, rgba(40, 60, 90, 0.30) 0%, rgba(0, 0, 0, 0) 55%),
              radial-gradient(ellipse at 20% 80%, rgba(60, 30, 80, 0.18) 0%, rgba(0, 0, 0, 0) 50%),
              var(--color-space)
            `,
          }}
        >
          <Scene />
        </div>

        {/* UI Overlays. Each chrome component opts itself into pointer
            events; the wrapper is pointer-events:none so the scene
            beneath stays grabbable wherever chrome doesn't sit. */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <UpdateModal />

          <TopStatusStrip />
          <BodySelector />
          <FrameCompass />
          <LeftRail
            onSettingsClick={() => setSimParamsOpen(true)}
            settingsActive={simParamsOpen}
          />
          <RightColumn />
          <Timeline />

          <SimParamsDialog open={simParamsOpen} onOpenChange={setSimParamsOpen} />

          {devMode && <DevPanel />}
        </div>
      </div>
    </div>
  );
};

export default Layout;
