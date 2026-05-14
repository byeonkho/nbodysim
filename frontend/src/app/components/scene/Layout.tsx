"use client";

import React, { useState, useSyncExternalStore } from "react";

import Scene from "@/app/components/scene/Scene";
import UpdateModal from "@/app/components/interface/misc/UpdateModal";
import { BodySelector } from "@/app/components/chrome/BodySelector";
import { FrameCompass } from "@/app/components/chrome/FrameCompass";
import { LeftRail } from "@/app/components/chrome/LeftRail";
import { RightColumn } from "@/app/components/chrome/RightColumn";
import { SimSetupDrawer } from "@/app/components/chrome/SimSetupDrawer";
import { Timeline } from "@/app/components/chrome/Timeline";
import { TopStatusStrip } from "@/app/components/chrome/TopStatusStrip";
import { DevPanel } from "@/app/components/dev/DevPanel";

const Layout: React.FC = () => {
  const [simSetupOpen, setSimSetupOpen] = useState(false);

  // Read ?dev=… once on mount. useSyncExternalStore is the React-canonical
  // pattern for "read an external value once" — SSR snapshot returns false
  // (server has no window), client snapshot reads the URL on hydration.
  // No re-subscription since the URL doesn't change mid-session.
  const devMode = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).has("dev"),
    () => false,
  );

  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <div className="grow relative overflow-hidden">
        {/* Load-time background fallback — visible during the brief gap
            before the skybox JPG loads (Skybox.tsx mounts the texture
            on scene.background, which then covers this layer). The
            Canvas inside <Scene /> is transparent (gl.alpha=true) so
            this gradient shows through until the skybox is in place.
            Lifted from the design handoff's `.starfield` CSS: inky
            `#050610` base with two soft elliptical glows. */}
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

          <TopStatusStrip
            onSimSetupClick={() => setSimSetupOpen(true)}
            simSetupActive={simSetupOpen}
          />
          <BodySelector />
          <FrameCompass />
          <LeftRail />
          <RightColumn />
          <Timeline />

          <SimSetupDrawer open={simSetupOpen} onOpenChange={setSimSetupOpen} />

          {devMode && <DevPanel />}
        </div>
      </div>
    </div>
  );
};

export default Layout;
