import type { DayStat, WeeklyReport } from "./types";

// Données réelles FHE (septembre 2026) pour le développement local : MOCK_DATA=1
const PRICE_IMPORT = 0.2051;
const PRICE_EXPORT = 0.1;
const PRICE_EXPORT_ABOVE = 0.05;
const EXPORT_CAP = 1143;

function day(date: string, prod: number, conso: number, rate: number | null): DayStat {
  const self = rate == null ? Math.min(prod, conso) : (prod * rate) / 100;
  return {
    date,
    production_kwh: prod,
    consumption_kwh: conso,
    self_consumption_kwh: +self.toFixed(2),
    grid_import_kwh: +Math.max(conso - self, 0).toFixed(2),
    grid_export_kwh: +Math.max(prod - self, 0).toFixed(2),
    self_consumption_rate: rate,
    self_sufficiency_rate: conso ? +((100 * self) / conso).toFixed(1) : null,
  };
}

function week(start: string, end: string, days: DayStat[]): WeeklyReport {
  const sum = (k: keyof DayStat) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  const prod = sum("production_kwh");
  const conso = sum("consumption_kwh");
  const self = sum("self_consumption_kwh");
  const exp = sum("grid_export_kwh");
  const best = days.reduce((a, d) => (d.production_kwh > a.production_kwh ? d : a), days[0]);
  return {
    start_date: start,
    end_date: end,
    production_kwh: +prod.toFixed(2),
    consumption_kwh: +conso.toFixed(2),
    self_consumption_kwh: +self.toFixed(2),
    grid_import_kwh: +sum("grid_import_kwh").toFixed(2),
    grid_export_kwh: +exp.toFixed(2),
    self_consumption_rate: prod ? +((100 * self) / prod).toFixed(1) : 0,
    self_sufficiency_rate: conso ? +((100 * self) / conso).toFixed(1) : 0,
    savings_import_eur: +(self * PRICE_IMPORT).toFixed(2),
    revenue_export_eur: +(exp * PRICE_EXPORT).toFixed(2),
    savings_total_eur: +(self * PRICE_IMPORT + exp * PRICE_EXPORT).toFixed(2),
    price_import: PRICE_IMPORT,
    price_export: PRICE_EXPORT,
    price_export_above: PRICE_EXPORT_ABOVE,
    export_cap_kwh: EXPORT_CAP,
    export_at_tier1_kwh: +exp.toFixed(2),
    export_at_tier2_kwh: 0,
    export_cap_remaining_kwh: +(EXPORT_CAP - exp).toFixed(2),
    grid_cost_eur: +(sum("grid_import_kwh") * PRICE_IMPORT).toFixed(2),
    best_day: best.date,
    best_day_production_kwh: best.production_kwh,
    days,
    created_at: `${end}T22:00:00Z`,
    updated_at: `${end}T22:00:00Z`,
  };
}

export const MOCK_REPORTS: WeeklyReport[] = [
  week("2026-09-14", "2026-09-20", [
    day("2026-09-14", 8.66, 11.98, 56.76),
    day("2026-09-15", 9.37, 15.76, 83.87),
    day("2026-09-16", 7.63, 12.29, 51.8),
    day("2026-09-17", 6.95, 13.09, 64.64),
    day("2026-09-18", 8.45, 11.79, 55.97),
    day("2026-09-19", 9.19, 14.28, 75.07),
    day("2026-09-20", 5.78, 12.75, 89.93),
  ]),
  week("2026-09-07", "2026-09-13", [
    day("2026-09-07", 0, 0, null),
    day("2026-09-08", 0, 0, null),
    day("2026-09-09", 2.28, 3.03, 51.49),
    day("2026-09-10", 8.8, 12.93, 63.1),
    day("2026-09-11", 6.53, 11.31, 60.43),
    day("2026-09-12", 10.17, 15.95, 57.1),
    day("2026-09-13", 8.32, 12.79, 68.54),
  ]),
  week("2026-08-31", "2026-09-06", [
    day("2026-08-31", 9.9, 12.1, 52),
    day("2026-09-01", 10.72, 13.09, 44.96),
    day("2026-09-02", 9.59, 10.31, 49.39),
    day("2026-09-03", 6.97, 13.01, 85.5),
    day("2026-09-04", 9.05, 11.09, 47.14),
    day("2026-09-05", 10.8, 14.28, 59.55),
    day("2026-09-06", 4.42, 9.52, 76.1),
  ]),
];
