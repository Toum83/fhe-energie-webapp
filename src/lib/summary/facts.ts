// Chiffres de la semaine mis en texte pour la synthèse rédigée par Claude (lib/summary/generate.ts).
// Fonction pure, testée par tests/summary.test.ts : seuls ces chiffres sont donnés au modèle,
// il ne doit rien inventer d'autre.

import type { GasWeek } from "../gas";
import type { DeviceGroup } from "../nilm/group";
import type { MeasuredDevice } from "../nilm/measured";
import type { WeeklyReport } from "../types";

export type WeekFacts = {
  report: WeeklyReport;
  previous?: WeeklyReport;
  devices: DeviceGroup[];
  measured: MeasuredDevice[];
  baseW: number | null;
  gas: GasWeek | null;
  gasPrevious: GasWeek | null;
};

const f1 = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
const weekday = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const delta = (cur: number, prev: number | undefined) =>
  prev == null || prev === 0 ? "" : ` (semaine précédente : ${f1(prev)}, ${cur >= prev ? "+" : ""}${Math.round((100 * (cur - prev)) / prev)} %)`;

export function weekFacts({ report: r, previous: p, devices, measured, baseW, gas, gasPrevious }: WeekFacts): string {
  const lines = [
    `Semaine du ${r.start_date} au ${r.end_date}.`,
    `Production solaire : ${f1(r.production_kwh)} kWh${delta(r.production_kwh, p?.production_kwh)}.`,
    `Consommation électrique : ${f1(r.consumption_kwh)} kWh${delta(r.consumption_kwh, p?.consumption_kwh)}.`,
    `Soutiré au réseau : ${f1(r.grid_import_kwh)} kWh ; injecté (surplus vendu) : ${f1(r.grid_export_kwh)} kWh.`,
    `Autoconsommation : ${Math.round(r.self_consumption_rate)} % de la production consommée sur place.`,
    `Couverture solaire : ${Math.round(r.self_sufficiency_rate)} % de la consommation.`,
    `Économies : ${f1(r.savings_total_eur)} € (dont ${f1(r.revenue_export_eur)} € de surplus vendu).`,
    "Jour par jour (production / consommation, kWh) :",
    ...r.days.map((d) => `- ${weekday(d.date)} ${d.date} : ${f1(d.production_kwh)} / ${f1(d.consumption_kwh)}`),
  ];
  if (devices.length || measured.length) {
    lines.push("Consommation par appareil (estimation basse par signature, sauf « mesuré par prise ») :");
    for (const m of measured) lines.push(`- ${m.label} : ${f1(m.kwh)} kWh, mesuré par prise${m.complete ? "" : ` depuis le ${m.since}`}`);
    for (const d of devices) {
      const solar = d.solar_share == null ? "" : `, ~${Math.round(d.solar_share * 100)} % couvert par le solaire`;
      lines.push(`- ${d.label} : ${f1(d.energy_kwh)} kWh, ${d.sessions} utilisation${d.sessions > 1 ? "s" : ""}${solar}`);
    }
  }
  if (baseW != null) lines.push(`Fond permanent (veilles, frigo, box…) : ~${Math.round(baseW)} W jour et nuit.`);
  if (gas && gas.knownDays > 0) {
    lines.push(
      `Gaz (chauffage + plaques de cuisson, ${gas.knownDays} jour${gas.knownDays > 1 ? "s" : ""} publiés par GRDF) : ${f1(gas.gasKwh)} kWh, ` +
        `dont chauffage ${f1(gas.heatingKwh)} kWh, coût ${f1(gas.costEur)} €.`,
    );
    if (gas.heatingHours != null) lines.push(`Heures de chauffe (thermostat) : ${f1(gas.heatingHours)} h.`);
    if (gas.kwhPerDju != null) {
      const prev = gasPrevious?.kwhPerDju;
      lines.push(`Chauffage corrigé de la météo : ${f1(gas.kwhPerDju)} kWh par degré-jour${prev != null ? ` (semaine précédente : ${f1(prev)})` : ""}.`);
    }
  }
  return lines.join("\n");
}
