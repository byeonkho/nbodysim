# Handoff: Sim Setup as Primary Entrypoint

## Overview

The spacesim app's "simulation parameters" (epoch, frame, integrator, Δt, bodies) is the
**first thing a new user needs to interact with** — it's how they configure and start a
simulation. In the original Hybrid direction it lived as a small unlabeled gear icon on
the left rail, where it didn't read as an entrypoint at all.

This handoff promotes sim setup to a **prominent, labeled primary action** in the top
bar, paired with a **clickable summary chip** that shows the current configuration at
a glance. Both open the same drawer.

## About the design files

The files in this bundle are **design references created in HTML/React** — prototypes
showing intended look and behavior, **not production code to copy directly**. The task
is to recreate these designs in the spacesim codebase using its established patterns,
component library, and styling system. If no environment exists yet, choose the most
appropriate framework and implement the designs there.

The mocks render as static React components against a fixed 1920×1080 artboard. In the
real app, replace mock data with live simulation state and wire up the click handlers.

## Fidelity

**High-fidelity.** Exact colors, typography, spacing, radii, shadows, and component
structure should be reproduced as documented. Layout numbers below are pixel values
from the 1920×1080 mock.

## What changed (vs the original Hybrid direction)

| Element                         | Before                                 | After                                                                |
| ------------------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| spacesim logo block (top-left)  | logo + wordmark                        | **removed** (no functional purpose; entrypoint owns that slot)       |
| Sim params entrypoint           | unlabeled gear icon, 5th on left rail  | **labeled primary button at top-left of top bar**                    |
| Frame / Integrator / Δt readout | three separate inert cells in top bar  | **single clickable "Configuration" chip** summarising current setup  |
| Left rail                       | mixed view + settings icons            | purely navigation (view modes / orbit / layers / camera)             |

Both new entrypoints open the same drawer panel.

## Screens / Views

### 1. Hero — closed state

`HybridV2Hero` in `dir-hybrid-v2.jsx`.

**Top bar** (absolute, top: 18, left: 24, right: 24, height: 46, glass panel)

Left → right:

1. **Sim setup button** (primary CTA, leading the bar)
    - Padding `8px 16px 8px 14px`, radius `10px`, gap `9px`
    - Background: `linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)`
    - Border: `1px solid rgba(196,200,255,0.85)`
    - Text color: `#16182a`, font-size `13px`, weight `600`, letter-spacing `-0.005em`
    - Box-shadow: `0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.50), 0 1px 0 rgba(255,255,255,0.55) inset`
    - Surrounding cell has a radial wash: `radial-gradient(circle at 50% 120%, rgba(164,168,255,0.18), transparent 70%)`
    - **Pulse dot** at top-right corner: `9×9` white circle, `box-shadow: 0 0 0 2px rgba(164,168,255,0.55), 0 0 8px rgba(255,255,255,0.8)`
    - Icon: 15×15 settings/gear glyph, stroke-width `1.8`
    - Label: `Sim setup`
    - Keyboard hint: `⌘K` in a small dark chip
    - Click → opens drawer
2. **Configuration chip** (secondary entrypoint, shows current state)
    - Inline label "CONFIG" in mono small caps + `Frame: Heliocentric · Integrator: RK4 (highlighted indigo) · Δt: 3600 s · Bodies: 9`
    - Trailing chevron-down
    - Faint indigo underline hints clickability
    - Click → opens the same drawer
3. **UTC** readout · `2024-06-17 07:00:00.000` (mono, white)
4. **JD** readout · `2 460 478.79167` (mono, white)
5. *(flex spacer)*
6. **FPS** `144` (green)
7. **REC** indicator with amber dot + `00:14:22` (amber background tint)

Below the top bar: body selector pill row, body card on right, event log on right,
timeline scrubber on bottom, ghost labels and selection reticle on the canvas — all
unchanged from the original Hybrid direction.

**Left rail** (absolute, top: 50%, left: 24, transform: translateY(-50%))

Reduced from 5 + footer to 4 icons. Gear removed. Remaining icons (top→bottom):
view/sun, orbit, layers, camera. Active state: indigo background `rgba(164,168,255,0.18)`,
accent color `#a4a8ff`.

### 2. Drawer open

`HybridV2Open` in `dir-hybrid-v2.jsx`.

Both entrypoints open the **same drawer**: a glass panel anchored top-left under the
top bar.

- Position: `top: 80, left: 24, bottom: 114, width: 440`
- Background: `rgba(20,22,30,0.62)`, backdrop blur `22px saturate(150%)`
- Border: `1px solid rgba(255,255,255,0.06)`, radius `14px`
- Drop shadow: `0 30px 80px rgba(0,0,0,0.65)`, with subtle indigo glow ring
- Canvas behind the drawer gets a scrim: `rgba(5,6,12,0.35)` + 2px blur

**Drawer header** (top, with subtle indigo gradient wash)

- Eyebrow: `SIMULATION PARAMETERS` mono, indigo `#a4a8ff`, letter-spacing `0.22em`
- Title: `Configure simulation` (18px, weight 600)
- Subtitle: `Changes apply on Run. Epoch, frame and integrator define how the system evolves.` (11.5px, dim)
- Close button (top right, 28×28, ×)

**Drawer body** (form fields, gap 14px)

1. **Epoch** (read-only field) — `2024-05-06 00:00:00 UTC`, sub `UTC · J2000-relative`
2. **Reference frame** (select) — `Heliocentric` ▾ · options: Heliocentric, Solar-system barycenter, Geocentric
3. **Integrator** (select, **highlighted** in indigo) — `RK4` ▾ · options: Euler, RK4, DOPRI8 (DP853)
    - Help text below: `Euler · simple, visibly drifts. RK4 · balanced default. DP853 · adaptive, high accuracy.`
4. **Two-column row**
    - Time unit (select) — `Hours` · options: Seconds, Hours, Days
    - Δt step (field) — `3600 s`
5. **Celestial bodies** grid (2 columns)
    - Heading: `CELESTIAL BODIES` + right-aligned `9 of 10 enabled` in indigo
    - Each tile: 14×14 indigo checkbox + 9×9 colored body dot + name
    - Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune — on
    - Moon — off (muted background, empty checkbox)

**Drawer footer** (sticky, separated by top border, `rgba(255,255,255,0.02)` bg)

- Primary **Run simulation** button — full-width-ish (flex 1), indigo gradient like the top-bar button, play-triangle icon
- Secondary **Save preset** button — small outlined button to its right

**Top-bar state when drawer open**

- `Sim setup` button switches from filled-indigo to **outlined active** state:
    - Background `linear-gradient(180deg, rgba(164,168,255,0.28), rgba(164,168,255,0.18))`
    - Border `1px solid rgba(164,168,255,0.55)`
    - Text reverts to white
    - Pulse dot hidden
- Configuration chip cell gets a subtle `rgba(164,168,255,0.06)` background
- This signals "you're already in setup" without competing with the open panel

## Interactions & behavior

- **Click `Sim setup` button** → open drawer
- **Click Configuration chip** → open drawer (same drawer)
- **`⌘K` / `Ctrl+K`** → open drawer (keyboard shortcut hinted on the button)
- **Click `×`** → close drawer
- **Click `Run simulation`** → apply params, close drawer, start/restart sim
- **Click `Save preset`** → open a "name this preset" affordance (out of scope here)
- When drawer is open: top-bar entrypoint shows the active outlined state described above
- Drawer should animate in from the left (suggested: 200ms ease-out for transform/opacity)
- Canvas scrim and blur should fade in over the same duration

## State management

- `drawerOpen: boolean` — controls drawer visibility + top-bar button state
- `simParams: { epoch, frame, integrator, timeUnit, dtStep, bodies[] }` — the configurable model
- `simParams` should have a "draft" copy that the drawer mutates; commit to the running sim only on **Run simulation**, so cancelling discards changes
- Keyboard: bind `⌘K` / `Ctrl+K` globally → `setDrawerOpen(true)`
- Bind `Esc` while drawer open → `setDrawerOpen(false)`

## Design tokens

### Colors

| Token            | Value                       | Use                                    |
| ---------------- | --------------------------- | -------------------------------------- |
| `bg`             | `#0a0b10`                   | app background                         |
| `text`           | `#dcdde3`                   | default body text                      |
| `hi`             | `#f4f5f8`                   | high-emphasis text                     |
| `dim`            | `#7f828d`                   | secondary text                         |
| `subdim`         | `#5a5d68`                   | tertiary text / mono small caps        |
| `accent`         | `#a4a8ff`                   | indigo accent (primary interactive)    |
| `accent-grad`    | `linear-gradient(180deg, #c4c8ff, #9298ee)` | primary button fill        |
| `accent-glow`    | `rgba(164,168,255,0.50)`    | button outer glow / focus halo         |
| `amber`          | `#f0a942`                   | recording / warning                    |
| `success`        | `#7dd3a0`                   | FPS / healthy metrics                  |
| `glass-bg`       | `rgba(20,22,30,0.62)`       | panel background                       |
| `glass-border`   | `rgba(255,255,255,0.06)`    | panel border / dividers                |
| `glass-blur`     | `blur(22px) saturate(150%)` | backdrop-filter                        |

### Typography

- UI sans: **Inter**, system-ui fallback. 13px default body.
- Mono: **JetBrains Mono**, `font-variant-numeric: tabular-nums`. Used for all numeric readouts, eyebrows, and timestamps.
- Eyebrows / small caps: mono, `font-size: 9–10px`, `letter-spacing: 0.18–0.22em`, `text-transform: uppercase`.
- Headings inside drawer: Inter, 18px, weight 600, letter-spacing `-0.015em`.

### Spacing & radius

- Top bar padding: top 18, side 24, height 46
- Panel radius: 14px (panels), 9–10px (buttons), 8px (form fields), 999px (pill row), 4px (small chips)
- Drawer inner padding: 14px vertical, 20px horizontal
- Form-field padding: 9px 12px
- Field gap inside drawer: 14px between sections, 6px between grid tiles

### Shadows

- Panel: `0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.5)`
- Drawer: `0 1px 0 rgba(255,255,255,0.05) inset, 0 30px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(164,168,255,0.10)`
- Primary button: `0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.50), 0 1px 0 rgba(255,255,255,0.55) inset`

## Assets

- Fonts: Inter, JetBrains Mono — both from Google Fonts (already used in app)
- Icons: inline SVG, no external assets. Sizes 11–15px, stroke-width 1.5 (UI) or 1.8 (primary button)
- Body colors: per planet (Sun `#ffb554`, Mercury `#a59387`, Venus `#e6c692`, Earth `#5d8fd6`, Mars `#c5573a`, Jupiter `#d4a566`, Saturn `#dcb474`, Uranus `#7fc7c5`, Neptune `#4a78c0`, Moon `#cccccc`)

## Files in this bundle

- `dir-hybrid-v2.jsx` — **the main source for this handoff**. Defines `HybridV2Hero` and `HybridV2Open`, including the new `H2TopBar`, `H2Drawer`, `H2LeftRail`, and supporting field/select helpers.
- `dir-hybrid.jsx` — original Hybrid direction. Several supporting components are reused unchanged: `HyGhost`, `HyReticle`, `HyCompass`, `HyScaleBar`, `HyBodyCard`, `HyEventLog`, `HyTimeline`.
- `shared.jsx` — shared scene definition (`SCENE`, `Scene`, `Orbits`, body coordinates, `shadeColor` helper).
- `design-canvas.jsx` — utility wrapper for laying out artboards side-by-side; not part of the production design.
- `preview.html` — standalone page that renders both states (closed + drawer-open) at 1920×1080. Open this to compare against your implementation.

## Implementation notes

- The pulse dot on the Sim setup button is a static dot, not animated, in this mock. If you want it to actually pulse in production, a 1.5s `transform: scale()` + opacity loop reads well — but only show it until the user has run their first simulation; turn it off after that.
- The Configuration chip is read-only summary; clicking *anywhere* on the chip opens the drawer. Consider also making each part deep-link to the relevant field once focused (e.g. clicking "RK4" jumps focus to the Integrator select).
- The drawer is positioned absolutely against the app shell, not the viewport — make sure it respects whatever app chrome (sidebars, headers) exists in the real codebase.
- When opening the drawer, the right-side body card stays visible (faded to 55% opacity in the mock). The event log is hidden to give the drawer room. Consider whether to keep the body card visible at all in your impl — the value is that the user can see what they're configuring against.
