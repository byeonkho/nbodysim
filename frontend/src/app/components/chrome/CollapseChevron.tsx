// Caret affordance for the collapsible chrome panels. Points down (▾) when
// expanded, rotates to point right (▸) when collapsed. Same glyph as the body
// selector's group-chip caret, for visual consistency.
interface CollapseChevronProps {
  collapsed: boolean;
}

export function CollapseChevron({ collapsed }: CollapseChevronProps) {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[#8c8f99]"
      style={{
        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
      }}
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}
