import { BODY_DISPLAY, type BodyKey } from "@/app/constants/BodyVisuals";
import {
  MOONS_BY_PARENT,
  masterState,
  type MoonParent,
} from "@/app/constants/BodyCatalog";
import { BodySphere } from "@/app/components/chrome/BodySphere";
import { ToggleSwitch } from "@/app/components/chrome/ToggleSwitch";
import { BodyChip } from "@/app/components/chrome/simSetup/BodyChip";

// One card per moon parent: header (parent sphere + name + n/total + master
// toggle) over a column of moon chips. Honors the live search: filters its
// moons, and removes itself entirely when a query matches none of them.
export function MoonParentCard({
  parent,
  selected,
  query,
  onToggleBody,
  onSetMany,
}: {
  parent: MoonParent;
  selected: Set<BodyKey>;
  query: string;
  onToggleBody: (key: BodyKey) => void;
  onSetMany: (keys: readonly BodyKey[], enable: boolean) => void;
}) {
  const moons = MOONS_BY_PARENT[parent];
  const visible = query
    ? moons.filter((m) => BODY_DISPLAY[m].toLowerCase().includes(query))
    : moons;
  if (query && visible.length === 0) return null;

  const state = masterState(moons, selected);
  const n = moons.filter((m) => selected.has(m)).length;

  return (
    <div
      className="overflow-hidden"
      style={{
        borderRadius: 11,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div
        className="flex items-center gap-2.5"
        style={{
          padding: "9px 11px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <BodySphere body={parent} size={13} />
        <span className="text-text flex-1 text-[12.5px] font-semibold">
          {BODY_DISPLAY[parent]}
        </span>
        <span
          className="tabular font-mono text-[10px]"
          style={{ color: n > 0 ? "var(--color-accent)" : "var(--color-subdim)" }}
        >
          {n}/{moons.length}
        </span>
        <button
          type="button"
          onClick={() => onSetMany(moons, state !== "on")}
          aria-label={`Toggle ${BODY_DISPLAY[parent]} moons`}
        >
          <ToggleSwitch state={state} w={34} />
        </button>
      </div>
      <div className="flex flex-col gap-[5px] p-2">
        {visible.map((m) => (
          <BodyChip
            key={m}
            bodyKey={m}
            on={selected.has(m)}
            onClick={() => onToggleBody(m)}
          />
        ))}
      </div>
    </div>
  );
}
