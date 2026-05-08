"use client";

// Phase 0 token harness — proves Tailwind compiles, @theme tokens generate
// utilities, both fonts load, and the glass + body-color recipes render
// correctly. Not part of the user-facing app; safe to delete once Phase 1
// surfaces exercise the same utilities in production code.

const BODIES = [
  ["Sun", "var(--color-body-sun)"],
  ["Mercury", "var(--color-body-mercury)"],
  ["Venus", "var(--color-body-venus)"],
  ["Earth", "var(--color-body-earth)"],
  ["Mars", "var(--color-body-mars)"],
  ["Jupiter", "var(--color-body-jupiter)"],
  ["Saturn", "var(--color-body-saturn)"],
  ["Uranus", "var(--color-body-uranus)"],
  ["Neptune", "var(--color-body-neptune)"],
  ["Moon", "var(--color-body-moon)"],
] as const;

const SURFACE_COLORS = [
  ["bg", "var(--color-bg)"],
  ["space", "var(--color-space)"],
] as const;

const TEXT_COLORS = [
  ["text", "var(--color-text)"],
  ["hi", "var(--color-hi)"],
  ["dim", "var(--color-dim)"],
  ["subdim", "var(--color-subdim)"],
] as const;

const STATUS_COLORS = [
  ["accent", "var(--color-accent)"],
  ["accent-grad-end", "var(--color-accent-grad-end)"],
  ["amber", "var(--color-amber)"],
  ["success", "var(--color-success)"],
] as const;

function shade(hex: string, percent: number) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + percent));
  const b = Math.max(0, Math.min(255, (num & 0xff) + percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const BODY_HEX: Record<string, string> = {
  Sun: "#ffb554",
  Mercury: "#a59387",
  Venus: "#e6c692",
  Earth: "#5d8fd6",
  Mars: "#c5573a",
  Jupiter: "#d4a566",
  Saturn: "#dcb474",
  Uranus: "#7fc7c5",
  Neptune: "#4a78c0",
  Moon: "#bfc4cc",
};

export default function TokensTestPage() {
  return (
    <div className="min-h-screen bg-bg p-8 font-sans text-text">
      {/* Starfield-ish backdrop so glass blur has something to blur */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background: `
            radial-gradient(ellipse at 60% 35%, rgba(40,60,90,0.30) 0%, rgba(0,0,0,0) 55%),
            radial-gradient(ellipse at 20% 80%, rgba(60,30,80,0.18) 0%, rgba(0,0,0,0) 50%),
            var(--color-space)
          `,
        }}
      />

      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex items-center gap-3">
          <div
            className="h-7 w-7 rounded-md"
            style={{
              background:
                "linear-gradient(135deg, var(--color-accent), var(--color-accent-grad-end))",
              boxShadow: "0 4px 14px rgba(164,168,255,0.4)",
            }}
          />
          <div>
            <h1 className="text-hi text-lg font-semibold tracking-tight">
              spacesim · design tokens
            </h1>
            <p className="eyebrow mt-1">PHASE 0 · TOKEN HARNESS</p>
          </div>
        </header>

        {/* Glass surface demo */}
        <section className="glass p-5">
          <p className="eyebrow mb-3">GLASS SURFACE</p>
          <p className="text-text text-sm leading-relaxed">
            This card uses <code className="font-mono text-accent">@utility glass</code>.
            Behind it: starfield gradient. The blur should be visible at the panel
            edges.
          </p>
        </section>

        {/* Typography */}
        <section className="glass p-5">
          <p className="eyebrow mb-3">TYPOGRAPHY</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="eyebrow mb-2">SANS · INTER</p>
              <p className="text-hi text-2xl font-bold tracking-tight">
                The quick brown fox
              </p>
              <p className="text-text text-base">jumps over the lazy dog</p>
              <p className="text-dim text-sm">300 / 400 / 500 / 600 / 700</p>
            </div>
            <div>
              <p className="eyebrow mb-2">MONO · JETBRAINS</p>
              <p className="text-hi tabular font-mono text-base">
                2 460 478.79167
              </p>
              <p className="text-accent tabular font-mono text-sm">
                Speed 29.291 km/s
              </p>
              <p className="text-success tabular font-mono text-sm">
                ΔE/E₀ 2.3×10⁻⁹
              </p>
            </div>
          </div>
        </section>

        {/* Color tokens */}
        <section className="glass p-5">
          <p className="eyebrow mb-3">COLOR TOKENS</p>
          <SwatchRow label="Surfaces" entries={SURFACE_COLORS} />
          <SwatchRow label="Text" entries={TEXT_COLORS} />
          <SwatchRow label="Status" entries={STATUS_COLORS} />
        </section>

        {/* Body color circles */}
        <section className="glass p-5">
          <p className="eyebrow mb-3">BODY PALETTE · CHROME RENDERING</p>
          <div className="flex flex-wrap items-end gap-6">
            {BODIES.map(([name]) => {
              const hex = BODY_HEX[name];
              return (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div
                    className="h-12 w-12 rounded-full"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${hex} 0%, ${hex} 50%, ${shade(hex, -60)} 100%)`,
                      boxShadow: `0 0 12px ${hex}66`,
                    }}
                  />
                  <span className="text-dim text-xs">{name}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Selection ring + accent button */}
        <section className="glass flex items-center gap-4 p-5">
          <p className="eyebrow flex-1">PRIMARY ACTION</p>
          <button
            className="h-9 rounded-[10px] px-5 text-sm font-medium text-[var(--color-bg)]"
            style={{
              background:
                "linear-gradient(135deg, var(--color-accent), var(--color-accent-grad-end))",
              boxShadow: "0 6px 16px rgba(164,168,255,0.35)",
            }}
          >
            Run sim
          </button>
        </section>
      </div>
    </div>
  );
}

function SwatchRow({
  label,
  entries,
}: {
  label: string;
  entries: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-dim mb-2 text-xs">{label}</p>
      <div className="flex flex-wrap gap-3">
        {entries.map(([name, value]) => (
          <div
            key={name}
            className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-1.5"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <span
              className="h-4 w-4 rounded"
              style={{
                background: value,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
              }}
            />
            <code className="font-mono text-xs text-text">{name}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
