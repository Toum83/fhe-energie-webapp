type Props = {
  /** 0–100 */
  value: number | null;
  color: string;
  size?: number;
  stroke?: number;
  label: string;
};

/** Anneau de progression (SVG, animé en CSS). */
export function Ring({ value, color, size = 96, stroke = 10, label }: Props) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label} : ${Math.round(v)} %`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={stroke} />
        <circle
          className="ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - v / 100)}
          style={{ "--circ": circ } as React.CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="num text-[1.5rem] leading-none">
          {value == null ? "—" : Math.round(v)}
          {value == null ? null : <span className="ml-0.5 align-top text-[0.7rem] font-semibold tracking-normal text-muted">%</span>}
        </span>
      </div>
    </div>
  );
}
