import {
  FRAME_LABELS,
  INTEGRATORS,
  TIME_UNITS,
  type TimeUnit,
} from "@/app/constants/SimParams";
import { type FidelityBucket } from "@/app/constants/PlaybackQuality";
import { PlaybackQualityPicker } from "@/app/components/chrome/PlaybackQualityPicker";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import { formatTimeStep } from "@/app/utils/dateMath";
import {
  EPOCH_COPY,
  INTEGRATOR_COPY,
  INTEGRATOR_HELP,
  PLAYBACK_QUALITY_COPY,
  REFERENCE_FRAME_COPY,
  TIME_STEP_COPY,
} from "@/app/constants/glossaryTooltipCopy";

// Left pane of the Sim Setup modal: the parameters that define how the system
// evolves. Fully controlled by the modal (draft state lives there).
export function SimParamsPane({
  epoch,
  onEpoch,
  frame,
  onFrame,
  integrator,
  onIntegrator,
  timeUnit,
  onTimeUnit,
  fidelityBucket,
  onFidelity,
}: {
  epoch: string;
  onEpoch: (v: string) => void;
  frame: string;
  onFrame: (v: string) => void;
  integrator: string;
  onIntegrator: (v: string) => void;
  timeUnit: TimeUnit;
  onTimeUnit: (v: TimeUnit) => void;
  fidelityBucket: FidelityBucket;
  onFidelity: (b: FidelityBucket) => void;
}) {
  return (
    <div
      className="w-[372px] shrink-0 overflow-y-auto border-r border-white/[0.06]"
      style={{ padding: "22px 24px" }}
    >
      <MField label="Epoch" tooltip={EPOCH_COPY}>
        <input
          type="datetime-local"
          value={epoch}
          step="0.001"
          onChange={(e) => onEpoch(e.target.value)}
          className="text-hi tabular w-full bg-transparent font-mono text-[14px] outline-none"
          style={{ colorScheme: "dark" }}
        />
      </MField>

      <MField label="Reference frame" tooltip={REFERENCE_FRAME_COPY}>
        <Select value={frame} onChange={onFrame}>
          {FRAME_LABELS.map((f) => (
            <option key={f} value={f} className="bg-bg">
              {f}
            </option>
          ))}
        </Select>
      </MField>

      <MField
        label="Integrator"
        highlight
        tooltip={INTEGRATOR_COPY}
        help={INTEGRATOR_HELP}
      >
        <Select value={integrator} onChange={onIntegrator} accent testId="integrator-select">
          {INTEGRATORS.map(([value, label]) => (
            <option key={value} value={value} className="bg-bg">
              {label}
            </option>
          ))}
        </Select>
      </MField>

      <div className="grid grid-cols-2 gap-3">
        <MField label="Time unit">
          <Select
            value={timeUnit}
            onChange={(v) => onTimeUnit(v as TimeUnit)}
          >
            {TIME_UNITS.map((u) => (
              <option key={u} value={u} className="bg-bg">
                {u}
              </option>
            ))}
          </Select>
        </MField>
        <MField label="Δt step" tooltip={TIME_STEP_COPY}>
          <div className="text-hi tabular font-mono text-[14px]">
            {formatTimeStep(timeUnit)}
          </div>
        </MField>
      </div>

      <p className="eyebrow mb-2 flex items-center gap-1.5 px-0.5">
        Playback quality
        <InfoTooltip label="What is playback quality?">
          {PLAYBACK_QUALITY_COPY}
        </InfoTooltip>
      </p>
      <PlaybackQualityPicker bucket={fidelityBucket} onChange={onFidelity} />
      <p className="text-dim mt-2.5 px-0.5 text-[11px] leading-[1.5]">
        Lower quality sends fewer snapshots, so downloads are smaller and
        smoother and the motion in between is filled in automatically. Higher
        quality sends every step.
      </p>
    </div>
  );
}

function MField({
  label,
  help,
  highlight,
  tooltip,
  children,
}: {
  label: string;
  help?: string;
  highlight?: boolean;
  /** Optional plain-English explanation shown as a hover chip by the label. */
  tooltip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="eyebrow mb-[7px] flex items-center gap-1.5 px-0.5">
        {label}
        {tooltip && <InfoTooltip label={`What is ${label}?`}>{tooltip}</InfoTooltip>}
      </p>
      <div
        style={{
          padding: "10px 13px",
          borderRadius: 10,
          border: highlight
            ? "1px solid rgba(164,168,255,0.32)"
            : "1px solid rgba(255,255,255,0.08)",
          background: highlight
            ? "rgba(164,168,255,0.06)"
            : "rgba(255,255,255,0.04)",
        }}
      >
        {children}
      </div>
      {help && (
        <p className="text-dim mt-[7px] px-0.5 text-[11px] leading-[1.5]">
          {help}
        </p>
      )}
    </div>
  );
}

// Plain styled native select: appearance-none + a non-interactive caret.
// (Not the mock's transparent-overlay trick; the native control is simpler
// and fully accessible.)
function Select({
  value,
  onChange,
  accent,
  testId,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  accent?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full cursor-pointer appearance-none bg-transparent pr-5 text-[14px] outline-none"
        style={{
          color: accent ? "var(--color-accent)" : "var(--color-hi)",
          fontWeight: accent ? 500 : 400,
        }}
      >
        {children}
      </select>
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        fill="none"
        stroke="var(--color-dim)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 opacity-70"
        aria-hidden
      >
        <path d="M2.5 4l3 3 3-3" />
      </svg>
    </div>
  );
}
