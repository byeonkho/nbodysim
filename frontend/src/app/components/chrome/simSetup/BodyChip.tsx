import { BODY_DISPLAY, type BodyKey } from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Catalog body chip. The whole chip is one toggle button: sphere + name + a
// checkbox that fills accent when enabled. Enabled = indigo border + tint +
// bright text + filled check.
export function BodyChip({
  bodyKey,
  on,
  onClick,
}: {
  bodyKey: BodyKey;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 text-left transition-all"
      style={{
        padding: "9px 11px",
        borderRadius: 9,
        border: on
          ? "1px solid rgba(164,168,255,0.40)"
          : "1px solid rgba(255,255,255,0.07)",
        background: on ? "rgba(164,168,255,0.10)" : "rgba(255,255,255,0.025)",
      }}
    >
      <BodySphere body={bodyKey} size={14} glow={on} />
      <span
        className="flex-1 overflow-hidden text-[13.5px] text-ellipsis whitespace-nowrap"
        style={{ color: on ? "var(--color-hi)" : "var(--color-dim)" }}
      >
        {BODY_DISPLAY[bodyKey]}
      </span>
      <span
        className="grid shrink-0 place-items-center"
        style={{
          width: 15,
          height: 15,
          borderRadius: 5,
          background: on ? "var(--color-accent)" : "transparent",
          border: on ? "none" : "1px solid rgba(255,255,255,0.18)",
        }}
      >
        {on && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="#0a0b10"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1.5 4.5L3.5 6.5 7.5 2" />
          </svg>
        )}
      </span>
    </button>
  );
}
