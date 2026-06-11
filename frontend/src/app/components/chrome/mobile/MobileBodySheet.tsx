"use client";

import React, { useEffect, useRef } from "react";
import { Drawer } from "vaul";
import { useDispatch, useSelector, useStore } from "react-redux";
import * as THREE from "three";
import type { AppDispatch, RootState } from "@/app/store/Store";
import {
  type CelestialBodyProperties,
  type Vector3Simple,
  setIsBodyActive,
  selectActiveBodyName,
  selectIsBodyActive,
  selectCelestialBodyPropertiesList,
  selectDisplayFrame,
} from "@/app/store/slices/SimulationSlice";
import {
  readBodyStateInto,
  readDeltaERelativeAt,
} from "@/app/store/chunkBuffer";
import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  subtractInto,
} from "@/app/utils/helpers";
import { computeOrbitalElements } from "@/app/utils/orbitalElements";
import { formatAccuracy } from "@/app/utils/formatAccuracy";

const REFRESH_HZ_MS = 200;
const AU_METRES = 1.495978707e11;
const RAD_TO_DEG = 180 / Math.PI;

// Local presentational formatters: trimmed copies of BodyCard's unexported
// locals (BodyCard.tsx:531-547) so the desktop card stays untouched. The lone
// "—" is the allowed no-data placeholder.
function formatSemiMajorAxis(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 0) return "hyperbolic";
  const au = metres / AU_METRES;
  if (Math.abs(au) >= 0.01) return `${au.toFixed(4)} AU`;
  return `${Math.round(metres / 1000).toLocaleString("en-US")} km`;
}

function formatDegrees(deg: number): string {
  if (!Number.isFinite(deg)) return "—";
  return `${deg.toFixed(2)}°`;
}

export function MobileBodySheet() {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const isBodyActive = useSelector(selectIsBodyActive);
  const activeName = useSelector(selectActiveBodyName);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const displayFrame = useSelector(selectDisplayFrame);

  // Name derivation mirrors BodyCard: range/speed are measured against the
  // state-vector reference (Moon -> Earth always; geo -> Earth; else the
  // orbiting body), while a/e/i are always against the orbiting body.
  const upperName = activeName?.trim().toUpperCase() ?? "";
  const activeProps = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";
  const stateVectorRefNameUpper =
    upperName === "MOON"
      ? "EARTH"
      : displayFrame === "geo"
        ? "EARTH"
        : orbitingNameUpper;
  const orbitingProps = propsList?.find(
    (p: CelestialBodyProperties) =>
      p.name?.trim().toUpperCase() === orbitingNameUpper,
  );
  const orbitingMu = orbitingProps?.mu;

  const rangeRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const aRef = useRef<HTMLSpanElement>(null);
  const eRef = useRef<HTMLSpanElement>(null);
  const iRef = useRef<HTMLSpanElement>(null);
  const accuracyRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isBodyActive || !upperName || !activeProps) return;

    // Scratch vectors hoisted out of tick: one allocation per effect run,
    // reused every 200 ms. Matches the hot-path convention in BodyCard.
    const bodyPos = new THREE.Vector3();
    const bodyVel = new THREE.Vector3();
    const stateRefPos = new THREE.Vector3();
    const stateRefVel = new THREE.Vector3();
    const orbPos = new THREE.Vector3();
    const orbVel = new THREE.Vector3();
    const velScratch: Vector3Simple = { x: 0, y: 0, z: 0 };

    const findIdx = (
      buffer: { bodyNameToIndex: ReadonlyMap<string, number> },
      nameUpper: string,
    ): number => {
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === nameUpper) return i;
      }
      return -1;
    };

    const dash = (r: React.RefObject<HTMLSpanElement | null>) => {
      if (r.current) r.current.textContent = "—";
    };

    const tick = () => {
      const state = store.getState();
      const buffer = state.simulation.chunkBuffer;
      const idx = state.simulation.timeState.currentTimeStepIndex;
      if (!buffer || idx >= buffer.totalTimesteps) return;

      const bodyIdx = findIdx(buffer, upperName);
      if (bodyIdx < 0) return;
      readBodyStateInto(bodyPos, bodyVel, buffer, idx, bodyIdx);

      // Range + speed against the state-vector reference body.
      const refIdx =
        stateVectorRefNameUpper && stateVectorRefNameUpper !== upperName
          ? findIdx(buffer, stateVectorRefNameUpper)
          : -1;
      if (refIdx >= 0) {
        readBodyStateInto(stateRefPos, stateRefVel, buffer, idx, refIdx);
        if (rangeRef.current) {
          rangeRef.current.textContent = calculateDistance(
            { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
            { x: stateRefPos.x, y: stateRefPos.y, z: stateRefPos.z },
            "AU",
          );
        }
        subtractInto(
          velScratch,
          { x: bodyVel.x, y: bodyVel.y, z: bodyVel.z },
          { x: stateRefVel.x, y: stateRefVel.y, z: stateRefVel.z },
        );
        if (speedRef.current)
          speedRef.current.textContent = formatToKM(
            calculateMagnitude(velScratch),
          );
      } else {
        dash(rangeRef);
        dash(speedRef);
      }

      // Keplerian a / e / i against the orbiting body.
      const orbIdx = orbitingNameUpper
        ? findIdx(buffer, orbitingNameUpper)
        : -1;
      if (orbIdx >= 0 && orbitingMu && orbitingMu > 0) {
        readBodyStateInto(orbPos, orbVel, buffer, idx, orbIdx);
        const elements = computeOrbitalElements(
          { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
          { x: bodyVel.x, y: bodyVel.y, z: bodyVel.z },
          { x: orbPos.x, y: orbPos.y, z: orbPos.z },
          { x: orbVel.x, y: orbVel.y, z: orbVel.z },
          orbitingMu,
        );
        if (elements) {
          if (aRef.current)
            aRef.current.textContent = formatSemiMajorAxis(
              elements.semiMajorAxis,
            );
          if (eRef.current)
            eRef.current.textContent = elements.eccentricity.toFixed(4);
          if (iRef.current)
            iRef.current.textContent = formatDegrees(
              elements.inclination * RAD_TO_DEG,
            );
        } else {
          dash(aRef);
          dash(eRef);
          dash(iRef);
        }
      } else {
        dash(aRef);
        dash(eRef);
        dash(iRef);
      }

      if (accuracyRef.current)
        accuracyRef.current.textContent = formatAccuracy(
          readDeltaERelativeAt(buffer, idx),
        );
    };

    tick();
    const id = window.setInterval(tick, REFRESH_HZ_MS);
    return () => window.clearInterval(id);
  }, [
    store,
    isBodyActive,
    upperName,
    activeProps,
    orbitingNameUpper,
    orbitingMu,
    stateVectorRefNameUpper,
  ]);

  return (
    <Drawer.Root
      open={isBodyActive}
      modal={false}
      onOpenChange={(o) => {
        if (!o) dispatch(setIsBodyActive(false));
      }}
    >
      <Drawer.Portal>
        <Drawer.Content
          aria-describedby={undefined}
          className="glass-dock pointer-events-auto fixed inset-x-0 bottom-0 z-30 text-text"
        >
          <Drawer.Handle className="my-3" />
          {/* pb-28 clears the persistent transport bar (control sheet, z-40)
              so inspecting a body never hides transport. */}
          <div className="px-5 pb-28">
            <Drawer.Title className="text-hi text-lg font-medium">{activeName}</Drawer.Title>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-dim">Range</dt>
              <dd className="text-hi"><span ref={rangeRef} className="tabular font-mono" /></dd>
              <dt className="text-dim">Speed</dt>
              <dd className="text-hi"><span ref={speedRef} className="tabular font-mono" /></dd>
              <dt className="text-dim">Orbit size</dt>
              <dd className="text-hi"><span ref={aRef} className="tabular font-mono" /></dd>
              <dt className="text-dim">Roundness</dt>
              <dd className="text-hi"><span ref={eRef} className="tabular font-mono" /></dd>
              <dt className="text-dim">Tilt</dt>
              <dd className="text-hi"><span ref={iRef} className="tabular font-mono" /></dd>
              <dt className="text-dim">Accuracy</dt>
              <dd className="text-hi"><span ref={accuracyRef} className="tabular font-mono" /></dd>
            </dl>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
