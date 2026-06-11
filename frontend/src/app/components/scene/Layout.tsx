"use client";

import React, { useState, useSyncExternalStore } from "react";

import Scene from "@/app/components/scene/Scene";
import FirstLoadSpinner from "@/app/components/interface/misc/FirstLoadSpinner";
import { BodySelector } from "@/app/components/chrome/BodySelector";
import { FrameCompass } from "@/app/components/chrome/FrameCompass";
import { RightColumn } from "@/app/components/chrome/RightColumn";
import { EventLogCard } from "@/app/components/chrome/EventLogCard";
import { SimSetupModal } from "@/app/components/chrome/simSetup/SimSetupModal";
import { Timeline } from "@/app/components/chrome/Timeline";
import { TopStatusStrip } from "@/app/components/chrome/TopStatusStrip";
import { DevPanel } from "@/app/components/dev/DevPanel";
import { TourOverlay } from "@/app/components/interface/tour/TourOverlay";
import { useIsMobile } from "@/app/utils/useIsMobile";
import { MobileChrome } from "@/app/components/chrome/mobile/MobileChrome";

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

  const isMobile = useIsMobile();

  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <div className="grow relative overflow-hidden">
        {/* Load-time background fallback — visible only during the brief
            gap before the skybox JPG loads (Skybox.tsx mounts the texture
            on scene.background, which then covers this layer). The
            Canvas inside <Scene /> is transparent (gl.alpha=true) so
            this layer shows through until the skybox is in place.

            LQIP: a 64×32 heavily-blurred crop of the full skybox JPG,
            inlined as base64 (~1.3 KB) so it ships with the HTML and
            renders at zero network cost. Stretched to cover via CSS
            (background-size: cover). When the full equirect skybox
            loads on top, the visible transition is "soft blur sharpens
            into stars" rather than "blue gradient flips to starfield".
            The CSS projection isn't an exact match for three.js's
            spherical projection of the equirect, but at this blur level
            only luminance + colour gradients matter — the dominant
            darkness + faint Milky Way smear sells the continuity. */}
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `url("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QDMRXhpZgAASUkqAFgAAABPcGVuSW1hZ2VJTyAzLjEuMTMuMSA6IDdGOTYwOTMxNkY4ODM2QkFBRDBEMTY1NjM2MEIyMDZGMzE3OUE3OTAASAAAAAEAAABIAAAAAQAAAAQAMQECAEAAAAAIAAAAGgEFAAEAAABIAAAAGwEFAAEAAABQAAAAaYcEAAEAAACOAAAAAAAAAAQAAJAHAAQAAAAwMjMwAZEHAAQAAAABAgMAAKAHAAQAAAAwMTAwAaADAAEAAAABAAAAAAAAAP/bAEMACgcHCAcGCggICAsKCgsOGBAODQ0OHRUWERgjHyUkIh8iISYrNy8mKTQpISIwQTE0OTs+Pj4lLkRJQzxINz0+O//bAEMBCgsLDg0OHBAQHDsoIig7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O//AABEIACAAQAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APHM04DNNFTRp3oAQJTgg7mmu2DTN5pATeTkcGmNGVoSQg9assA8WaAKRpM05xg0ymBKsZJ6VOwCR4709p48cLVd33GgCJjzTaewHakxQACrloVY7W6GqYFSI+00gJ7m22sdvIqsYyO1XFuhtwwzQZYT1WgZ/9k=") center/cover, var(--color-space)`,
          }}
        >
          <Scene />
        </div>

        {/* UI Overlays. Each chrome component opts itself into pointer
            events; the wrapper is pointer-events:none so the scene
            beneath stays grabbable wherever chrome doesn't sit. */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <FirstLoadSpinner />

          {isMobile ? (
            <MobileChrome />
          ) : (
            <>
              <TopStatusStrip
                onSimSetupClick={() => setSimSetupOpen(true)}
                simSetupActive={simSetupOpen}
              />
              <BodySelector />
              <FrameCompass />
              <RightColumn />

              {/* Event log — docked bottom-left, just above the timeline.
                  Collapsible (collapsed by default); expands upward into the
                  scene, capped so it scrolls internally rather than overrunning
                  the top chrome. */}
              <div className="pointer-events-auto absolute bottom-[160px] left-6 w-[316px]">
                <EventLogCard />
              </div>

              <Timeline />

              <SimSetupModal open={simSetupOpen} onOpenChange={setSimSetupOpen} />

              <TourOverlay simSetupOpen={simSetupOpen} />
            </>
          )}

          {devMode && <DevPanel />}
        </div>
      </div>
    </div>
  );
};

export default Layout;
