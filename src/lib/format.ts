const kwhFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const pctFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export const kwh = (v: number | null | undefined) =>
  v == null ? "—" : `${kwhFormatter.format(v)} kWh`;
export const eur = (v: number | null | undefined) => (v == null ? "—" : eurFormatter.format(v));
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${pctFormatter.format(v)} %`);

export function weekLabel(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric" });
  const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  if (s.getMonth() === e.getMonth()) return `${day.format(s)}–${dayMonth.format(e)}`;
  return `${dayMonth.format(s)} – ${dayMonth.format(e)}`;
}

export function longDate(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

export function shortWeekday(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" }).format(new Date(iso));
}
