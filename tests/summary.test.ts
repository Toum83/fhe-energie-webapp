// Lancer : node --test tests/summary.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { weekFacts } from "../src/lib/summary/facts.ts";
import { measuredDevices } from "../src/lib/nilm/measured.ts";

const day = (date: string, p: number, c: number) => ({
  date, production_kwh: p, consumption_kwh: c, self_consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0,
  self_consumption_rate: null, self_sufficiency_rate: null,
});
const report = {
  start_date: "2026-10-19", end_date: "2026-10-25", production_kwh: 52.34, consumption_kwh: 98.1,
  self_consumption_kwh: 40, grid_import_kwh: 58.1, grid_export_kwh: 12.3, self_consumption_rate: 76.4,
  self_sufficiency_rate: 40.8, savings_total_eur: 9.87, savings_import_eur: 8, revenue_export_eur: 1.2,
  days: [day("2026-10-19", 8.2, 14), day("2026-10-25", 3.1, 15.6)],
} as never;

test("synthèse : les chiffres donnés au modèle, arrondis, avec la semaine précédente et les prises", () => {
  const measured = measuredDevices([{ day: "2026-10-24", measured: { lave_vaisselle: 1.656 } }], ["2026-10-24", "2026-10-25"]);
  const text = weekFacts({
    report,
    previous: { ...(report as object), production_kwh: 40 } as never,
    devices: [{ key: "c:7", label: "Chauffe-eau en haut", icon: null, energy_kwh: 21.5, sessions: 7, solar_share: 0.62, parts: [] }],
    measured,
    baseW: 231.4,
    gas: null,
    gasPrevious: null,
  });
  assert.match(text, /Production solaire : 52,3 kWh \(semaine précédente : 40, \+31 %\)/);
  assert.match(text, /lundi 2026-10-19 : 8,2 \/ 14/);
  assert.match(text, /Lave-vaisselle : 1,7 kWh, mesuré par prise depuis le 2026-10-24/);
  assert.match(text, /Chauffe-eau en haut : 21,5 kWh, 7 utilisations, ~62 % couvert par le solaire/);
  assert.match(text, /~231 W/);
  assert.doesNotMatch(text, /Gaz/);
});
