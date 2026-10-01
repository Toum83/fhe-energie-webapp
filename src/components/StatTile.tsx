import type { ReactNode } from "react";

type Props = {
  label: string;
  value: string;
  unit?: string;
  hint?: ReactNode;
  accent?: "prod" | "conso" | "auto" | "none";
  /** Index pour l'animation d'entrée échelonnée. */
  index?: number;
  className?: string;
};

const accentClass = {
  prod: "bg-prod",
  conso: "bg-conso",
  auto: "bg-auto",
  none: "bg-faint",
} as const;

export function StatTile({ label, value, unit, hint, accent = "none", index = 0, className = "" }: Props) {
  return (
    <div className={`card rise flex min-w-0 flex-col gap-2 p-5 ${className}`} style={{ "--i": index } as React.CSSProperties}>
      <div className="eyebrow flex items-center gap-2">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${accentClass[accent]}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className="num text-[2rem] leading-none">
        {value}
        {unit ? <span className="ml-1 text-base font-semibold tracking-normal text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="text-xs leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}
