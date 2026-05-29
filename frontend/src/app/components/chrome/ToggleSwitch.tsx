import type { ToggleState } from "@/app/constants/BodyCatalog";

// Tri-state toggle. "mixed" = knob centered + accent-tinted track + a dash on
// the knob, so it reads distinct from both off and on. Presentation only;
// click semantics (mixed -> on, the macOS convention) live in the parent.
export function ToggleSwitch({
  state,
  w = 44,
}: {
  state: ToggleState;
  w?: number;
}) {
  const h = Math.round((w * 26) / 44);
  const knob = h - 4;
  const left =
    state === "on" ? w - knob - 2 : state === "mixed" ? (w - knob) / 2 : 2;
  const bg =
    state === "on"
      ? "var(--color-accent)"
      : state === "mixed"
        ? "rgba(164, 168, 255, 0.32)"
        : "rgba(255,255,255,0.10)";
  return (
    <span
      className="relative inline-block shrink-0 rounded-full transition-colors"
      style={{ width: w, height: h, background: bg }}
    >
      <span
        className="absolute flex items-center justify-center rounded-full bg-white transition-[left]"
        style={{
          top: 2,
          left,
          width: knob,
          height: knob,
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      >
        {state === "mixed" && (
          <span
            style={{
              width: knob * 0.4,
              height: 2,
              borderRadius: 1,
              background: "rgba(146, 152, 238, 0.95)",
            }}
          />
        )}
      </span>
    </span>
  );
}
