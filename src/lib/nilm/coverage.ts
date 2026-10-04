// Part d'une semaine couverte par la détection NILM (qui démarre à la date du 1er événement).

export type Coverage = {
  /** Jours de la semaine (lundi→dimanche) à partir du 1er événement, 0..7. */
  coveredDays: number;
  partial: boolean;
  /** Dates (YYYY-MM-DD) couvertes. */
  dates: string[];
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** firstEvent = null (inconnu) : on suppose la semaine entièrement couverte. */
export function weekCoverage(weekStart: string, firstEvent: string | null): Coverage {
  const all = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  if (!firstEvent) return { coveredDays: 7, partial: false, dates: all };
  const dates = all.filter((d) => d >= firstEvent);
  return { coveredDays: dates.length, partial: dates.length < 7, dates };
}
