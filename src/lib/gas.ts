// Gaz (Gazpar, total par jour) séparé en chauffage / cuisson, pour le bilan hebdo.
// Fonctions pures, testées par tests/gas.test.ts.
//
// Gazpar ne donne qu'un total journalier : impossible de repérer les pics de cuisson dans
// la journée. La cuisson est donc estimée par la conso d'été (gaz sans chauffage) et le
// reste est du chauffage. La chaudière ne fait que le chauffage (l'eau chaude est électrique).

export const GAS = {
  /** Prix du kWh de gaz TTC, hors abonnement (facture EDF, octobre 2026). */
  priceEurPerKwh: 0.113,
  /**
   * Socle cuisson (plaques gaz) en kWh/jour : moyenne juin–septembre 2026 relevée par GRDF
   * (29 kWh sur 122 jours). À recalculer chaque fin d'été.
   */
  cookingKwhPerDay: 0.25,
  /** Base des degrés-jours unifiés (DJU) : 18 °C, la convention française. */
  djuBaseC: 18,
};

export type GasDayRow = {
  day: string; // YYYY-MM-DD
  gas_kwh: number | string | null;
  temp_ext: number | string | null;
  heating_hours: number | string | null;
};

export type GasDay = {
  date: string;
  gasKwh: number | null;
  heatingKwh: number | null;
  cookingKwh: number | null;
  tempC: number | null;
  dju: number | null;
  heatingHours: number | null;
};

export type GasWeek = {
  days: GasDay[];
  /** Jours de la semaine dont GRDF a déjà publié le gaz (retard de 1 à 2 jours). */
  knownDays: number;
  lastKnownDay: string | null;
  gasKwh: number;
  heatingKwh: number;
  cookingKwh: number;
  costEur: number;
  heatingCostEur: number;
  /** DJU des jours connus seulement, pour rester comparable au gaz. */
  dju: number;
  heatingHours: number | null;
  /** kWh de chauffage par DJU : la conso corrigée de la météo. null si la semaine est trop douce. */
  kwhPerDju: number | null;
  /** kWh de gaz par heure de chauffe (thermostat). null sans heures mesurées. */
  kwhPerHeatingHour: number | null;
};

const n = (v: number | string | null | undefined) => (v == null || v === "" ? null : Number(v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function addDays(iso: string, k: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

/** Sépare un total journalier de gaz en cuisson (socle) et chauffage (le reste). */
export function splitGas(gasKwh: number, cookingKwhPerDay = GAS.cookingKwhPerDay) {
  const cooking = Math.min(Math.max(gasKwh, 0), cookingKwhPerDay);
  return { cookingKwh: round(cooking), heatingKwh: round(Math.max(gasKwh - cooking, 0)) };
}

export function dju(tempC: number, base = GAS.djuBaseC): number {
  return round(Math.max(base - tempC, 0), 1);
}

/** Bilan gaz de la semaine commençant le lundi `weekStart`. */
export function gasWeek(rows: GasDayRow[], weekStart: string): GasWeek {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const days: GasDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const r = byDay.get(date);
    const gas = n(r?.gas_kwh);
    const temp = n(r?.temp_ext);
    const hours = n(r?.heating_hours);
    // Le thermostat dit que la chaudière n'a pas chauffé : tout le gaz du jour est de la
    // cuisson (un gros repas dépasse vite le socle moyen de 0,25 kWh).
    const split = gas == null ? null : hours === 0 ? { cookingKwh: round(Math.max(gas, 0)), heatingKwh: 0 } : splitGas(gas);
    return {
      date,
      gasKwh: gas,
      heatingKwh: split?.heatingKwh ?? null,
      cookingKwh: split?.cookingKwh ?? null,
      tempC: temp,
      dju: temp == null ? null : dju(temp),
      heatingHours: hours,
    };
  });
  const known = days.filter((d) => d.gasKwh != null);
  const sum = (f: (d: GasDay) => number | null, list = known) => list.reduce((a, d) => a + (f(d) ?? 0), 0);
  const gasKwh = sum((d) => d.gasKwh);
  const heatingKwh = sum((d) => d.heatingKwh);
  const weekDju = sum((d) => d.dju);
  const withHours = known.filter((d) => d.heatingHours != null);
  const hours = withHours.length ? sum((d) => d.heatingHours, withHours) : null;
  const gasWithHours = sum((d) => d.gasKwh, withHours);
  return {
    days,
    knownDays: known.length,
    lastKnownDay: known.length ? known[known.length - 1].date : null,
    gasKwh: round(gasKwh),
    heatingKwh: round(heatingKwh),
    cookingKwh: round(sum((d) => d.cookingKwh)),
    costEur: round(gasKwh * GAS.priceEurPerKwh),
    heatingCostEur: round(heatingKwh * GAS.priceEurPerKwh),
    dju: round(weekDju, 1),
    heatingHours: hours == null ? null : round(hours, 1),
    // Semaine douce ou sans vrai chauffage : le ratio n'a pas de sens (quelques kWh de repas
    // classés « chauffage » divisés par presque rien).
    kwhPerDju: weekDju >= 5 && heatingKwh >= 5 ? round(heatingKwh / weekDju) : null,
    kwhPerHeatingHour: hours != null && hours >= 1 ? round(gasWithHours / hours) : null,
  };
}
