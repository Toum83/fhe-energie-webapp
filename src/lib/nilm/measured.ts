// Appareils mesurés par une prise connectée (Koogeek) pour le bilan par appareil.
// HA envoie chaque soir les compteurs du jour (`measured`, table gas_daily). Une mesure
// remplace l'estimation NILM de la même famille. Fonction pure, testée par tests/nilm.test.ts.

export type MeasuredRow = { day: string; measured?: Record<string, number | string | null> | null };

/** Prises connues : clé envoyée par HA → libellé, et cartes NILM que la mesure remplace. */
export const PLUGS: { key: string; label: string; icon: string; replaces: RegExp }[] = [
  { key: "lave_vaisselle", label: "Lave-vaisselle", icon: "🍽️", replaces: /^lave-vaisselle/i },
  { key: "coin_cinema", label: "Coin cinéma", icon: "🎬", replaces: /^vid[ée]o\s*proj/i },
];

export type MeasuredDevice = {
  key: string;
  label: string;
  icon: string;
  kwh: number;
  /** Premier jour mesuré parmi les jours demandés. */
  since: string;
  /** La prise couvre tous les jours demandés : l'estimation NILM correspondante est retirée. */
  complete: boolean;
  replaces: RegExp;
};

export function measuredDevices(rows: MeasuredRow[], dates: string[]): MeasuredDevice[] {
  const wanted = new Set(dates);
  const out: MeasuredDevice[] = [];
  for (const plug of PLUGS) {
    const days = rows
      .filter((r) => wanted.has(r.day) && r.measured && r.measured[plug.key] != null && r.measured[plug.key] !== "")
      .map((r) => ({ day: r.day, kwh: Number(r.measured![plug.key]) }))
      .filter((d) => Number.isFinite(d.kwh) && d.kwh >= 0)
      .sort((a, b) => a.day.localeCompare(b.day));
    if (days.length === 0) continue;
    out.push({
      key: plug.key,
      label: plug.label,
      icon: plug.icon,
      kwh: Math.round(days.reduce((a, d) => a + d.kwh, 0) * 100) / 100,
      since: days[0].day,
      complete: days.length === wanted.size,
      replaces: plug.replaces,
    });
  }
  return out.sort((a, b) => b.kwh - a.kwh);
}

/** Retire les familles NILM remplacées par une prise qui couvre toute la période. */
export function withoutMeasured<T extends { label: string }>(groups: T[], measured: MeasuredDevice[]): T[] {
  return groups.filter((g) => !measured.some((m) => m.complete && m.replaces.test(g.label)));
}
