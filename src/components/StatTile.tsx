type Props = {
  label: string;
  value: string;
  hint?: string;
  accent?: "prod" | "conso" | "auto" | "none";
};

const accentClass = {
  prod: "bg-prod",
  conso: "bg-conso",
  auto: "bg-auto",
  none: "bg-border",
} as const;

export function StatTile({ label, value, hint, accent = "none" }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase leading-tight tracking-wide text-muted">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${accentClass[accent]}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-faint">{hint}</div> : null}
    </div>
  );
}
