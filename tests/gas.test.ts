// Lancer : node --test tests/gas.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dju, gasWeek, splitGas, GAS } from "../src/lib/gas.ts";

test("cuisson = socle d'été, chauffage = le reste", () => {
  assert.deepEqual(splitGas(0.2), { cookingKwh: 0.2, heatingKwh: 0 }); // journée d'été : tout en cuisson
  assert.deepEqual(splitGas(30), { cookingKwh: GAS.cookingKwhPerDay, heatingKwh: 29.75 });
  assert.deepEqual(splitGas(-1), { cookingKwh: 0, heatingKwh: 0 });
});

test("DJU base 18 °C", () => {
  assert.equal(dju(10.3), 7.7);
  assert.equal(dju(21), 0);
});

test("semaine : jours manquants (retard GRDF), coût, ratios", () => {
  const w = gasWeek(
    [
      { day: "2026-10-05", gas_kwh: "20", temp_ext: "10", heating_hours: "4" },
      { day: "2026-10-06", gas_kwh: 30, temp_ext: 8, heating_hours: 6 },
      { day: "2026-10-07", gas_kwh: 0.2, temp_ext: 19, heating_hours: null },
      { day: "2026-10-09", gas_kwh: null, temp_ext: null, heating_hours: 2 }, // heures connues, gaz pas encore publié
      { day: "2026-09-30", gas_kwh: 99, temp_ext: 5, heating_hours: 9 }, // hors semaine
    ],
    "2026-10-05",
  );
  assert.equal(w.days.length, 7);
  assert.equal(w.knownDays, 3);
  assert.equal(w.lastKnownDay, "2026-10-07");
  assert.equal(w.gasKwh, 50.2);
  assert.equal(w.heatingKwh, 49.5);
  assert.equal(w.cookingKwh, 0.7);
  assert.equal(w.costEur, Math.round(50.2 * 0.113 * 100) / 100);
  assert.equal(w.dju, 18); // 8 + 10 + 0
  assert.equal(w.kwhPerDju, 2.75);
  assert.equal(w.heatingHours, 10); // seulement les jours où le gaz est connu
  assert.equal(w.kwhPerHeatingHour, 5);
});

test("semaine douce ou sans heures : pas de ratio trompeur", () => {
  const w = gasWeek([{ day: "2026-10-05", gas_kwh: 2, temp_ext: 16, heating_hours: null }], "2026-10-05");
  assert.equal(w.kwhPerDju, null);
  assert.equal(w.kwhPerHeatingHour, null);
});

test("jour sans chauffe (thermostat) : tout le gaz est de la cuisson", () => {
  const w = gasWeek([{ day: "2026-10-05", gas_kwh: 1.4, temp_ext: 18, heating_hours: 0 }], "2026-10-05");
  assert.equal(w.days[0].cookingKwh, 1.4);
  assert.equal(w.days[0].heatingKwh, 0);
});

test("semaine d'intersaison : pas de kWh/DJU sur quelques kWh", () => {
  const w = gasWeek(
    [
      { day: "2026-09-28", gas_kwh: 0.8, temp_ext: 15, heating_hours: null },
      { day: "2026-10-01", gas_kwh: 1.4, temp_ext: 12, heating_hours: null },
    ],
    "2026-09-28",
  );
  assert.equal(w.kwhPerDju, null);
});
