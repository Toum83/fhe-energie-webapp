type Props = {
  current: number;
  previous: number | null | undefined;
  /** Sens considéré comme positif : production ↑ est bien, consommation ↓ est bien. */
  goodWhen: "up" | "down";
  /** Texte additionnel, ex. "vs sem. préc." */
  suffix?: string;
  /** Variante lisible sur fond coloré (carte héros). */
  onColor?: boolean;
};

/** Pastille de variation vs période précédente. */
export function Delta({ current, previous, goodWhen, suffix = "vs sem. préc.", onColor = false }: Props) {
  if (!previous) return null;
  const d = ((current - previous) / previous) * 100;
  if (!Number.isFinite(d)) return null;
  const rounded = Math.round(d);
  const flat = rounded === 0;
  const up = d > 0;
  const good = flat ? null : up === (goodWhen === "up");

  const tone = onColor
    ? "bg-white/20 text-white"
    : flat
      ? "bg-surface-2 text-muted"
      : good
        ? "bg-[color-mix(in_oklab,var(--series-auto)_16%,transparent)] text-[color-mix(in_oklab,var(--series-auto)_80%,var(--foreground))]"
        : "bg-[color-mix(in_oklab,#e5484d_14%,transparent)] text-[color-mix(in_oklab,#e5484d_85%,var(--foreground))]";

  return (
    <span className={`pill ${tone}`}>
      <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 ${flat ? "hidden" : up ? "" : "rotate-180"}`} fill="currentColor" aria-hidden>
        <path d="M6 1.5 11 9.5H1z" />
      </svg>
      {flat ? "stable" : `${up ? "+" : "−"}${Math.abs(rounded)} %`}
      {suffix ? <span className="font-medium opacity-70">{suffix}</span> : null}
    </span>
  );
}
