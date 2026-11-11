// Appareils mesurés par une prise connectée (Koogeek) pour le bilan par appareil.
// HA envoie chaque soir les compteurs du jour (`measured`, table gas_daily). Une mesure
// remplace l'estimation NILM de la même famille. Fonction pure, testée par tests/nilm.test.ts.
//
// Clés `ha_*` : compteurs NILM de HA corrigés à la main (trou de données comblé avec Linky,
// thermodynamique relevé sur son écran, appareil oublié…), envoyés après coup jour par jour.
// Ils ne remplacent l'estimation que s'ils couvrent toute la période, sinon ils sont ignorés
// (les ajouter à côté du NILM compterait deux fois les jours déjà vus par le NILM).

export type MeasuredRow = { day: string; measured?: Record<string, number | string | null> | null };

/** Prises connues : clé envoyée par HA → libellé, et cartes NILM que la mesure remplace. */
export type MeasuredSource = "prise" | "ha";

export const PLUGS: { key: string; label: string; icon: string; replaces: RegExp; source: MeasuredSource }[] = [
  { key: "lave_vaisselle", label: "Lave-vaisselle", icon: "🍽️", replaces: /^lave-vaisselle/i, source: "prise" },
  { key: "coin_cinema", label: "Coin cinéma", icon: "🎬", replaces: /^vid[ée]o\s*proj/i, source: "prise" },
  { key: "ha_chauffe_eau_haut", label: "Chauffe-eau en haut", icon: "🚿", replaces: /^chauffe-eau en haut/i, source: "ha" },
  { key: "ha_thermodynamique", label: "Chauffe-eau thermodynamique", icon: "♨️", replaces: /^chauffe-eau thermo/i, source: "ha" },
  { key: "ha_lave_linge", label: "Lave-linge", icon: "🧺", replaces: /^lave-linge/i, source: "ha" },
  { key: "ha_pc_lenny", label: "PC Lenny", icon: "🖥️", replaces: /^pc lenny/i, source: "ha" },
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
  source: MeasuredSource;
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
    if (plug.source === "ha" && days.length !== wanted.size) continue;
    out.push({
      key: plug.key,
      label: plug.label,
      icon: plug.icon,
      kwh: Math.round(days.reduce((a, d) => a + d.kwh, 0) * 100) / 100,
      since: days[0].day,
      complete: days.length === wanted.size,
      replaces: plug.replaces,
      source: plug.source,
    });
  }
  return out.sort((a, b) => b.kwh - a.kwh);
}

/** Retire les familles NILM remplacées par une prise qui couvre toute la période. */
export function withoutMeasured<T extends { label: string }>(groups: T[], measured: MeasuredDevice[]): T[] {
  return groups.filter((g) => !measured.some((m) => m.complete && m.replaces.test(g.label)));
}

/**
 * Chauffe-eau thermodynamique : le NILM ne le voit pas (compresseur ~300 W en démarrage doux, noyé
 * dans la télé, le PC, la cuisine). Essai du 11/11/2026 par différence sur le signal maison :
 * erreur ~0,35 kWh/jour contre son écran, pas mieux qu'une valeur fixe. Par défaut, sa carte NILM
 * avance donc de 2,0 kWh par jour (moyenne de l'écran du 23/10 au 08/11 : 1,98), à 250 W pendant
 * sa plage 11 h – 19 h. Le relevé de l'écran (photo) corrige ensuite les statistiques HA du jour.
 */
export const THERMO_DEFAULT = {
  clusterId: 57,
  since: "2026-11-11",
  kwhPerDay: 2.0,
  fromHour: 11,
  toHour: 19,
  timeZone: "Europe/Paris",
} as const;

/** Heures locales (fractionnaires) d'une date en ms. */
function localClock(ms: number, timeZone: string): { day: string; hours: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hours: Number(parts.hour) + Number(parts.minute) / 60 + Number(parts.second) / 3600 };
}

/** kWh cumulés par défaut depuis `since` jusqu'à `nowMs` (jamais décroissant). */
export function thermoDefaultKwh(nowMs: number, cfg: { since: string; kwhPerDay: number; fromHour: number; toHour: number; timeZone: string } = THERMO_DEFAULT): number {
  const { day, hours } = localClock(nowMs, cfg.timeZone);
  if (day < cfg.since) return 0;
  const fullDays = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${cfg.since}T12:00:00Z`)) / 86400000);
  const span = cfg.toHour - cfg.fromHour;
  const today = Math.min(Math.max(hours - cfg.fromHour, 0), span) / span;
  return Math.round((fullDays + today) * cfg.kwhPerDay * 1000) / 1000;
}
