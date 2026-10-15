// Fond permanent de la maison (veilles, frigo, box, VMC…) pour le bilan par appareil.
// HA envoie chaque soir le 10e centile de la puissance consommée sur 24 h (`base_w`,
// table gas_daily). Fonction pure, testée par tests/nilm.test.ts.

export type BaseLoadRow = { day: string; base_w?: number | string | null };

export type BaseLoad = {
  /** Puissance de fond moyenne (W) sur les jours mesurés. */
  watts: number;
  /** Énergie sur tous les jours demandés (kWh), jours sans mesure estimés à la moyenne. */
  kwh: number;
  /** Jours avec une mesure, parmi `dates`. */
  measuredDays: number;
};

/** null si aucun des jours demandés n'a de mesure. */
export function baseLoad(rows: BaseLoadRow[], dates: string[]): BaseLoad | null {
  const wanted = new Set(dates);
  const values = rows
    .filter((r) => wanted.has(r.day) && r.base_w != null && r.base_w !== "")
    .map((r) => Number(r.base_w))
    .filter((w) => Number.isFinite(w) && w > 0);
  if (values.length === 0) return null;
  const watts = values.reduce((a, w) => a + w, 0) / values.length;
  return { watts, kwh: (watts * 24 * dates.length) / 1000, measuredDays: values.length };
}
