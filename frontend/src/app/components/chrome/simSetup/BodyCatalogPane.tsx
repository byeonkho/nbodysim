"use client";

import { useState } from "react";
import {
  BODY_DISPLAY,
  BODY_ORDER,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import {
  ALL_MOONS,
  MOON_PARENT_ORDER,
  MOONS_BY_PARENT,
  PLANET_KEYS,
  PRESETS,
  SECTION_MEMBERS,
  TOP_LEVEL_BY_CATEGORY,
  masterState,
  matchesPreset,
  type ToggleState,
} from "@/app/constants/BodyCatalog";
import { ToggleSwitch } from "@/app/components/chrome/ToggleSwitch";
import { BodyChip } from "@/app/components/chrome/simSetup/BodyChip";
import { MoonParentCard } from "@/app/components/chrome/simSetup/MoonParentCard";

const TOTAL = BODY_ORDER.length;

// Right pane: the body catalog. Toolbar (count + cost hint + search), scenario
// presets, and four sections (Planets / Moons / Dwarf / NEAs). Owns the local
// search query; selection lives in the modal and flows in via props.
export function BodyCatalogPane({
  selected,
  onToggleBody,
  onSetMany,
  onSetSelection,
}: {
  selected: Set<BodyKey>;
  onToggleBody: (key: BodyKey) => void;
  onSetMany: (keys: readonly BodyKey[], enable: boolean) => void;
  onSetSelection: (keys: BodyKey[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const enabled = selected.size;

  const matches = (k: BodyKey) => !q || BODY_DISPLAY[k].toLowerCase().includes(q);

  const dwarfKeys = TOP_LEVEL_BY_CATEGORY.dwarfPlanet;
  const neaKeys = TOP_LEVEL_BY_CATEGORY.asteroid;

  const visiblePlanets = PLANET_KEYS.filter(matches);
  const visibleDwarf = dwarfKeys.filter(matches);
  const visibleNeas = neaKeys.filter(matches);
  const anyMoonMatches = ALL_MOONS.some(matches);
  const anyResults =
    visiblePlanets.length > 0 ||
    visibleDwarf.length > 0 ||
    visibleNeas.length > 0 ||
    anyMoonMatches;

  const countIn = (keys: readonly BodyKey[]) =>
    keys.filter((k) => selected.has(k)).length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div
        className="border-b border-white/[0.05]"
        style={{ padding: "18px 24px 14px" }}
      >
        <div className="mb-3 flex items-center gap-3.5">
          <div className="flex-1">
            <div className="text-hi text-[13px] font-semibold tracking-[-0.01em]">
              Celestial bodies
            </div>
            <div className="text-dim tabular mt-0.5 font-mono text-[11px]">
              <span className="text-accent">{enabled}</span> of {TOTAL} enabled
              {enabled > 12 && (
                <span className="text-subdim">
                  {" "}
                  · {enabled} data lookups on Run
                </span>
              )}
            </div>
          </div>
          {/* Search */}
          <div
            className="flex w-[230px] items-center gap-2"
            style={{
              padding: "8px 12px",
              borderRadius: 9,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="var(--color-dim)"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="5.5" cy="5.5" r="3.5" />
              <path d="M8.5 8.5L11 11" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bodies"
              className="text-hi min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-subdim grid place-items-center"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  fill="none"
                >
                  <path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-0.5">Scenarios</span>
          {PRESETS.map((p) => {
            const active = matchesPreset(p, selected);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSetSelection(p.keys)}
                style={{
                  padding: "6px 13px",
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(164,168,255,0.5)"
                    : "1px solid rgba(255,255,255,0.10)",
                  background: active
                    ? "rgba(164,168,255,0.16)"
                    : "rgba(255,255,255,0.03)",
                  color: active ? "var(--color-hi)" : "var(--color-text)",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                }}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onSetSelection([])}
            className="text-dim"
            style={{
              padding: "6px 11px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Catalog scroll */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: "18px 24px 24px" }}
      >
        {!anyResults && (
          <div className="text-dim py-16 text-center text-[13px]">
            No bodies match “{query}”.
          </div>
        )}

        {visiblePlanets.length > 0 && (
          <Section
            label="Planets"
            sub="Sun and the eight planets"
            count={countIn(PLANET_KEYS)}
            total={PLANET_KEYS.length}
            state={masterState(PLANET_KEYS, selected)}
            onToggle={() =>
              onSetMany(PLANET_KEYS, masterState(PLANET_KEYS, selected) !== "on")
            }
          >
            <Grid>
              {visiblePlanets.map((k) => (
                <BodyChip
                  key={k}
                  bodyKey={k}
                  on={selected.has(k)}
                  onClick={() => onToggleBody(k)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {anyMoonMatches && (
          <Section
            label="Moons"
            sub="Natural satellites, grouped by parent"
            count={countIn(ALL_MOONS)}
            total={ALL_MOONS.length}
            state={masterState(ALL_MOONS, selected)}
            onToggle={() =>
              onSetMany(ALL_MOONS, masterState(ALL_MOONS, selected) !== "on")
            }
          >
            <div className="grid grid-cols-3 items-start gap-2.5">
              {MOON_PARENT_ORDER.map((parent) => (
                <MoonParentCard
                  key={parent}
                  parent={parent}
                  selected={selected}
                  query={q}
                  onToggleBody={onToggleBody}
                  onSetMany={onSetMany}
                />
              ))}
            </div>
          </Section>
        )}

        {visibleDwarf.length > 0 && (
          <Section
            label="Dwarf planets"
            sub="Massive minor bodies"
            count={countIn(SECTION_MEMBERS.dwarfPlanet)}
            total={SECTION_MEMBERS.dwarfPlanet.length}
            state={masterState(SECTION_MEMBERS.dwarfPlanet, selected)}
            onToggle={() =>
              onSetMany(
                SECTION_MEMBERS.dwarfPlanet,
                masterState(SECTION_MEMBERS.dwarfPlanet, selected) !== "on",
              )
            }
          >
            <Grid>
              {visibleDwarf.map((k) => (
                <BodyChip
                  key={k}
                  bodyKey={k}
                  on={selected.has(k)}
                  onClick={() => onToggleBody(k)}
                />
              ))}
            </Grid>
          </Section>
        )}

        {visibleNeas.length > 0 && (
          <Section
            label="Near-Earth asteroids"
            sub="They feel the planets' gravity but don't tug back"
            count={countIn(SECTION_MEMBERS.asteroid)}
            total={SECTION_MEMBERS.asteroid.length}
            state={masterState(SECTION_MEMBERS.asteroid, selected)}
            onToggle={() =>
              onSetMany(
                SECTION_MEMBERS.asteroid,
                masterState(SECTION_MEMBERS.asteroid, selected) !== "on",
              )
            }
            last
          >
            <Grid>
              {visibleNeas.map((k) => (
                <BodyChip
                  key={k}
                  bodyKey={k}
                  on={selected.has(k)}
                  onClick={() => onToggleBody(k)}
                />
              ))}
            </Grid>
          </Section>
        )}
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

function Section({
  label,
  sub,
  count,
  total,
  state,
  onToggle,
  last,
  children,
}: {
  label: string;
  sub: string;
  count: number;
  total: number;
  state: ToggleState;
  onToggle: () => void;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={last ? undefined : "mb-[26px]"}>
      <div className="mb-[11px] flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span className="text-hi text-[13px] font-semibold tracking-[-0.01em]">
              {label}
            </span>
            <span
              className="tabular font-mono text-[11px]"
              style={{
                color: count > 0 ? "var(--color-accent)" : "var(--color-subdim)",
              }}
            >
              {count}/{total}
            </span>
          </div>
          <div className="text-subdim mt-0.5 text-[11px]">{sub}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Toggle all ${label}`}
        >
          <ToggleSwitch state={state} w={40} />
        </button>
      </div>
      {children}
    </div>
  );
}
