// Lancer : node --test tests/nilm.test.ts   (Node >= 22.6, type stripping natif)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dbscan,
  feature,
  mergeEvents,
  pairSessions,
  runPipeline,
  type ExistingCluster,
  type PowerEvent,
} from "../src/lib/nilm/algorithm.ts";

let nextId = 1;
const at = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 8, day, hh - 2, mm)).toISOString(); // heure de Paris (UTC+2 en septembre)

function ev(ts: string, delta: number, production = 0): PowerEvent {
  return { id: nextId++, ts, delta_w: delta, direction: delta > 0 ? "on" : "off", production_power: production };
}

/** Un cycle d'appareil : ON à t, OFF après `minutes`. */
function cycle(day: number, hh: number, mm: number, watts: number, minutes: number, production = 0): PowerEvent[] {
  const start = new Date(at(day, hh, mm));
  const end = new Date(start.getTime() + minutes * 60000);
  return [ev(start.toISOString(), watts, production), ev(end.toISOString(), -watts, production)];
}

test("mergeEvents fusionne un échelon étalé sur 2 relevés mais pas deux appareils distincts", () => {
  const events = [
    ev(at(1, 10, 0), 1000),
    ev(at(1, 10, 5), 800), // 5 min après, même sens : même échelon
    ev(at(1, 10, 30), 600), // 25 min plus tard : autre appareil
  ];
  const merged = mergeEvents(events);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].delta_w, 1800);
  assert.equal(merged[1].delta_w, 600);
});

test("pairSessions apparie par magnitude la plus proche, pas par ordre", () => {
  // ON 2000 W puis ON 500 W ; OFF 500 W arrive en premier : doit fermer le 500 W, pas le 2000 W.
  const events = [
    ev(at(1, 9, 0), 2000),
    ev(at(1, 9, 10), 500),
    ev(at(1, 9, 40), -500),
    ev(at(1, 10, 30), -2000),
  ];
  const { sessions, unpaired } = pairSessions(mergeEvents(events));
  assert.equal(unpaired, 0);
  const byPower = Object.fromEntries(sessions.map((s) => [s.power_w, s.duration_min]));
  assert.equal(byPower[500], 30);
  assert.equal(byPower[2000], 90);
});

test("pairSessions abandonne un ON sans OFF dans les 4 h", () => {
  const events = [ev(at(1, 6, 0), 1500), ev(at(1, 12, 0), -1500)];
  const { sessions, unpaired } = pairSessions(mergeEvents(events));
  assert.equal(sessions.length, 0);
  assert.equal(unpaired, 2);
});

test("dbscan sépare deux groupes et marque l'isolé comme bruit", () => {
  const pts = [
    feature(2000, 45), feature(2100, 50), feature(1950, 40), feature(2050, 47),
    feature(300, 600), feature(320, 650), feature(310, 580),
    feature(900, 5),
  ];
  const labels = dbscan(pts, 1, 3);
  assert.equal(new Set(labels.slice(0, 4)).size, 1);
  assert.equal(new Set(labels.slice(4, 7)).size, 1);
  assert.notEqual(labels[0], labels[4]);
  assert.equal(labels[7], -1);
});

test("pipeline : trouve deux appareils récurrents sans utiliser l'heure du jour", () => {
  nextId = 1;
  const events: PowerEvent[] = [];
  // Chauffe-eau ~2000 W / ~45 min, à des heures très variées (jour et nuit).
  [[1, 3], [2, 14], [3, 22], [4, 11], [5, 6]].forEach(([d, h], i) =>
    events.push(...cycle(d, h, 0, 2000 + i * 40, 45 + i * 2, h > 9 && h < 18 ? 3000 : 0)),
  );
  // Lave-linge ~1200 W / ~2 h.
  [[1, 19], [3, 10], [5, 21]].forEach(([d, h], i) => events.push(...cycle(d, h, 0, 1200 + i * 30, 120 + i * 5)));
  const result = runPipeline(events, []);
  assert.equal(result.stats.sessions, 8);
  assert.equal(result.clusters.length, 2);
  const counts = result.clusters.map((c) => c.occurrences).sort();
  assert.deepEqual(counts, [3, 5]);
  const big = result.clusters.find((c) => c.occurrences === 5)!;
  assert.ok(big.centroid_power_w > 1900 && big.centroid_power_w < 2300);
  assert.ok(big.avg_pct_solar > 0 && big.avg_pct_solar < 1); // jour/nuit mélangés
  assert.equal(big.hourly.reduce((a, b) => a + b, 0), 5);
});

test("un cluster nommé n'est jamais recréé ni renommé et capte les sessions déplacées dans la journée", () => {
  nextId = 1;
  const existing: ExistingCluster[] = [
    { id: 42, label: "Chauffe-eau", centroid_power_w: 2000, centroid_log_duration: Math.log(45) },
  ];
  // Seulement 2 occurrences (sous minPts) + décalées en heures solaires : sans le cluster nommé = bruit.
  const events = [...cycle(1, 13, 0, 2050, 48, 3500), ...cycle(2, 14, 30, 1980, 44, 3200)];
  const result = runPipeline(events, existing);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0].id, 42);
  assert.equal(result.clusters[0].key, "id:42");
  assert.ok(result.sessions.every((s) => s.cluster_key === "id:42"));
  assert.deepEqual(result.delete_ids, []);
});

test("les ids de clusters non nommés restent stables d'un run à l'autre", () => {
  nextId = 1;
  const events: PowerEvent[] = [];
  for (let d = 1; d <= 4; d++) events.push(...cycle(d, 8 + d, 0, 1500 + d * 20, 30 + d));
  const first = runPipeline(events, []);
  assert.equal(first.clusters.length, 1);
  assert.equal(first.clusters[0].id, null);
  const existing: ExistingCluster[] = [
    { id: 7, label: null, centroid_power_w: first.clusters[0].centroid_power_w, centroid_log_duration: first.clusters[0].centroid_log_duration },
  ];
  const second = runPipeline(events, existing);
  assert.equal(second.clusters[0].id, 7);
  assert.deepEqual(second.delete_ids, []);
});

test("un cluster non nommé qui disparaît est supprimé", () => {
  nextId = 1;
  const existing: ExistingCluster[] = [{ id: 9, label: null, centroid_power_w: 700, centroid_log_duration: Math.log(20) }];
  const result = runPipeline([], existing);
  assert.deepEqual(result.delete_ids, [9]);
});

/** Événement avec niveaux avant/après, comme les renvoie nilm_get_events. */
function lev(ts: string, before: number, after: number, production = 0): PowerEvent {
  return {
    id: nextId++,
    ts,
    delta_w: after - before,
    power_before: before,
    power_after: after,
    direction: after > before ? "on" : "off",
    production_power: production,
  };
}

test("gros appareil à arrêt progressif (chauffe-eau) : fermé au retour au niveau de départ", () => {
  nextId = 1;
  // Base 300 W, chauffe-eau +1700 W à 11:30, puissance qui décroît, coupure en 2 paliers vers 14:20.
  const events = [
    lev(at(1, 11, 30), 300, 2000, 2500),
    lev(at(1, 13, 0), 2000, 1500, 3000), // décroissance (palier -500 W)
    lev(at(1, 14, 15), 1500, 900, 2500), // palier -600 W
    lev(at(1, 14, 20), 900, 320, 2000), // retour à la base
  ];
  const { sessions } = pairSessions(mergeEvents(events));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].power_w, 1700);
  // Les 2 derniers paliers (14:15 puis 14:20) sont un seul échelon : l'arrêt est daté du premier.
  assert.equal(sessions[0].duration_min, 165);
  assert.equal(sessions[0].pct_solar, 1);
});

test("petit appareil : l'appariement reste par magnitude, même avec les niveaux", () => {
  nextId = 1;
  // Télé 300 W pendant qu'un autre appareil (800 W) s'arrête : le retour au niveau la fermerait à tort.
  const events = [
    lev(at(1, 20, 0), 500, 1300), // appareil 800 W
    lev(at(1, 20, 10), 1300, 1600), // télé 300 W
    lev(at(1, 20, 40), 1600, 800), // l'appareil 800 W s'arrête
    lev(at(1, 22, 0), 800, 500), // la télé s'arrête
  ];
  const { sessions } = pairSessions(mergeEvents(events));
  const tele = sessions.find((s) => s.power_w === 300)!;
  assert.equal(tele.duration_min, 110);
});

test("sans niveaux (ancienne fonction SQL) : retombe sur l'appariement par magnitude", () => {
  nextId = 1;
  const events = [ev(at(1, 11, 30), 1700), ev(at(1, 13, 0), -500), ev(at(1, 14, 20), -1200)];
  const { sessions } = pairSessions(mergeEvents(events));
  assert.equal(sessions.length, 1); // le palier final -1200 W est dans la tolérance de 35 %
});

test("part solaire : la production du crépuscule ne compte pas comme une session solaire", () => {
  nextId = 1;
  // Four 1700 W lancé à 19 h avec 120 W de production : environ 7 % couvert, pas 100 %.
  const dusk = pairSessions(mergeEvents([ev(at(1, 19, 0), 1700, 120), ev(at(1, 19, 10), -1700, 120)])).sessions[0];
  assert.equal(dusk.pct_solar, 0.07);
  // À midi avec 3 kW de production : entièrement couvert (plafonné à 100 %).
  const noon = pairSessions(mergeEvents([ev(at(1, 12, 0), 1700, 3000), ev(at(1, 12, 10), -1700, 3000)])).sessions[0];
  assert.equal(noon.pct_solar, 1);
  // La nuit : 0.
  const night = pairSessions(mergeEvents([ev(at(1, 22, 0), 1700, 0), ev(at(1, 22, 10), -1700, 0)])).sessions[0];
  assert.equal(night.pct_solar, 0);
});

test("YAML HA : identifiant et valeur basés sur cluster_id, pas sur le nom", async () => {
  const { haRestYaml } = await import("../src/lib/nilm/ha.ts");
  const yaml = haRestYaml([
    { cluster_id: 4, label: "Chauffe-eau en haut" },
    { cluster_id: 12, label: 'Four "pro"' },
  ]);
  assert.match(yaml, /unique_id: fhe_nilm_cluster_4\n/);
  assert.match(yaml, /value_template: "\{\{ value_json\.by_id\['4'\] \}\}"/);
  assert.match(yaml, /state_class: total_increasing/);
  assert.match(yaml, /# chauffe_eau_en_haut \(appareil n°4\)/);
  assert.match(yaml, /name: "NILM Four 'pro'"/); // guillemets neutralisés
  assert.match(yaml, /Authorization: !secret nilm_admin_bearer/);
});

test("couverture : semaine partielle quand la détection démarre en cours de semaine", async () => {
  const { weekCoverage } = await import("../src/lib/nilm/coverage.ts");
  // Semaine du lundi 21/09/2026, détection active depuis le vendredi 25/09 : 3 jours (ven, sam, dim).
  const c = weekCoverage("2026-09-21", "2026-09-25");
  assert.equal(c.coveredDays, 3);
  assert.equal(c.partial, true);
  assert.deepEqual(c.dates, ["2026-09-25", "2026-09-26", "2026-09-27"]);
  // Semaine suivante : entièrement couverte.
  const full = weekCoverage("2026-09-28", "2026-09-25");
  assert.equal(full.coveredDays, 7);
  assert.equal(full.partial, false);
  // Détection pas encore démarrée, ou date inconnue.
  assert.equal(weekCoverage("2026-09-14", "2026-09-25").coveredDays, 0);
  assert.equal(weekCoverage("2026-09-21", null).partial, false);
  // Passage de mois : lundi 28/09 -> dimanche 04/10.
  assert.equal(weekCoverage("2026-09-28", "2026-10-01").coveredDays, 4);
});

test("chauffe-eau démarré avec une bouilloire : la puissance est révélée quand la bouilloire coupe", async () => {
  nextId = 1;
  // Base 290 W. 11:30 chauffe-eau + bouilloire ensemble (+3 870 W), 11:40 la bouilloire coupe
  // (reste 1 943 W, soit +1 653 W), puis décroissance et retour à la base à 13:40.
  const events = [
    lev(at(4, 11, 30), 290, 4160),
    lev(at(4, 11, 40), 4160, 1943),
    lev(at(4, 12, 50), 1943, 1600),
    lev(at(4, 13, 40), 1257, 400),
  ];
  const { sessions } = pairSessions(mergeEvents(events));
  const long = sessions.find((s) => s.duration_min >= 60)!;
  assert.equal(long.power_w, 1653);
  assert.equal(long.duration_min, 130);
});

test("session courte (four 30 min) : la hauteur du saut est gardée, pas de révélation", () => {
  nextId = 1;
  // Four : +1 700 W, le thermostat coupe à 11 min (palier bas), relance, arrêt à 30 min.
  const events = [
    lev(at(2, 18, 30), 300, 2000),
    lev(at(2, 18, 41), 2000, 900),
    lev(at(2, 18, 46), 900, 2000),
    lev(at(2, 19, 0), 2000, 310),
  ];
  const { sessions } = pairSessions(mergeEvents(events));
  const four = sessions.find((s) => s.duration_min >= 25)!;
  assert.equal(four.power_w, 1700);
});

test("appareil long en marche : compté au fur et à mesure, seulement s'il n'y a qu'un candidat", async () => {
  const { runningSessions, mergeEvents, pairSessions } = await import("../src/lib/nilm/algorithm.ts");
  const start = at(7, 11, 30);
  const events: PowerEvent[] = [
    { id: nextId++, ts: start, delta_w: 1650, direction: "on", production_power: 0, power_before: 300, power_after: 1950 },
  ];
  const merged = mergeEvents(events);
  const { sessions } = pairSessions(merged);
  const named = [
    { id: 7, centroid_power_w: 1651, avg_duration_min: 162 }, // chauffe-eau
    { id: 6, centroid_power_w: 1709, avg_duration_min: 5 }, // four : trop court pour être candidat
    { id: 2, centroid_power_w: 325, avg_duration_min: 67 }, // autre puissance
  ];
  const now = (min: number) => new Date(start).getTime() + min * 60000;

  assert.deepEqual(runningSessions(merged, sessions, named, now(20)), [], "trop tôt : pas encore compté");
  const r = runningSessions(merged, sessions, named, now(60));
  assert.equal(r.length, 1);
  assert.equal(r[0].cluster_id, 7);
  assert.equal(r[0].kwh, 1.65);
  // Arrêt manqué : plafonné à la durée moyenne, puis abandonné au-delà de 4 h.
  const shortHeater = [{ id: 7, centroid_power_w: 1651, avg_duration_min: 100 }];
  assert.equal(runningSessions(merged, sessions, shortHeater, now(200))[0].kwh, 2.75); // 100 min au plus
  assert.deepEqual(runningSessions(merged, sessions, named, now(241)), []);
  // Deux appareils longs de même puissance : on ne choisit pas, compté à l'arrêt.
  assert.deepEqual(runningSessions(merged, sessions, [...named, { id: 9, centroid_power_w: 1700, avg_duration_min: 90 }], now(60)), []);
  // Une fois l'arrêt apparié, ce n'est plus une session en marche.
  const closed = mergeEvents([
    ...events,
    { id: nextId++, ts: new Date(now(150)).toISOString(), delta_w: -1650, direction: "off", production_power: 0, power_before: 1950, power_after: 300 },
  ]);
  assert.deepEqual(runningSessions(closed, pairSessions(closed).sessions, named, now(160)), []);
});
