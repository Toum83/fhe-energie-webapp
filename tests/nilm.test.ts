// Lancer : node --test tests/nilm.test.ts   (Node >= 22.6, type stripping natif)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clusterSessions,
  dbscan,
  feature,
  mergeEvents,
  pairSessions,
  PARAMS,
  pulseTrainSessions,
  runPipeline,
  washerCycleSessions,
  type Session,
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
  // Lave-linge ~1200 W / ~2 h (4 fois : une carte se forme à partir de 4 sessions).
  [[1, 19], [3, 10], [5, 21], [6, 15]].forEach(([d, h], i) => events.push(...cycle(d, h, 0, 1200 + i * 30, 120 + i * 5)));
  const result = runPipeline(events, []);
  assert.equal(result.stats.sessions, 9);
  assert.equal(result.clusters.length, 2);
  const counts = result.clusters.map((c) => c.occurrences).sort();
  assert.deepEqual(counts, [4, 5]);
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
  // Chauffe-eau du 08/10/2026 : démarre à 11 h 34, maison à 260 W avant.
  const start = at(8, 11, 34);
  const events: PowerEvent[] = [
    { id: nextId++, ts: start, delta_w: 1758, direction: "on", production_power: 0, power_before: 260, power_after: 2018 },
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
  // Sans mesure de la maison : puissance nominale.
  assert.deepEqual(runningSessions(merged, sessions, named, now(31)), [{ on_event_id: events[0].id, cluster_id: 7, watts: 1758, elapsed_min: 31 }]);
  // Mesurée : 12 h 34, maison à 1 485 W -> 1 225 W pour le chauffe-eau (il décroît).
  assert.equal(runningSessions(merged, sessions, named, now(60), 1485)[0].watts, 1225);
  // 13 h 45 : chauffe-eau coupé, mais ~700 W d'un autre appareil -> arrêté (moins de 50 % du nominal).
  assert.equal(runningSessions(merged, sessions, named, now(131), 927)[0].watts, 0);
  // Un autre appareil s'ajoute pendant la chauffe -> plafonné à 110 % du nominal.
  assert.equal(runningSessions(merged, sessions, named, now(60), 4000)[0].watts, Math.round(1.1 * 1758));
  // Rattrapage plafonné à la durée moyenne, puis abandonné au-delà de 4 h.
  const shortHeater = [{ id: 7, centroid_power_w: 1651, avg_duration_min: 100 }];
  assert.equal(runningSessions(merged, sessions, shortHeater, now(200))[0].elapsed_min, 100);
  assert.deepEqual(runningSessions(merged, sessions, named, now(241)), []);
  // Deux appareils longs de même puissance : on ne choisit pas, compté à l'arrêt.
  assert.deepEqual(runningSessions(merged, sessions, [...named, { id: 9, centroid_power_w: 1700, avg_duration_min: 90 }], now(60)), []);
  // Une fois l'arrêt apparié, ce n'est plus une session en marche.
  const closed = mergeEvents([
    ...events,
    { id: nextId++, ts: new Date(now(150)).toISOString(), delta_w: -1758, direction: "off", production_power: 0, power_before: 2018, power_after: 260 },
  ]);
  assert.deepEqual(runningSessions(closed, pairSessions(closed).sessions, named, now(160)), []);
});

test("bilan : les cartes « Famille · détail » sont additionnées, les autres restent seules", async () => {
  const { groupDevices, splitFamily } = await import("../src/lib/nilm/group.ts");
  assert.deepEqual(splitFamily("Cuisine · Bouilloire & four"), { family: "Cuisine", detail: "Bouilloire & four" });
  assert.deepEqual(splitFamily("Lave-linge"), { family: null, detail: "Lave-linge" });
  const g = groupDevices([
    { cluster_id: 6, label: "Cuisine · Bouilloire & four", icon: "☕", energy_kwh: 0.8, sessions: 10, solar_share: 0.5 },
    { cluster_id: 12, label: "cuisine · Four pleine puissance", icon: "🔥", energy_kwh: 1.2, sessions: 4, solar_share: 0 },
    { cluster_id: 7, label: "Chauffe-eau en haut", icon: "🚿", energy_kwh: 20, sessions: 7, solar_share: 0.3 },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].label, "Chauffe-eau en haut");
  assert.equal(g[1].label, "cuisine");
  assert.equal(g[1].energy_kwh, 2);
  assert.equal(g[1].sessions, 14);
  assert.equal(g[1].solar_share, 0.2);
  assert.deepEqual(g[1].parts.map((p) => p.label), ["Four pleine puissance", "Bouilloire & four"]);
});

test("gros appareil en marche : pas de rabattement sur un OFF voisin tant que sa fenêtre est ouverte", async () => {
  const { runningSessions } = await import("../src/lib/nilm/algorithm.ts");
  // 09/10/2026 : chauffe-eau 11 h 24 (221 -> 2 066 W), lave-vaisselle 11 h 54 (+1 680), arrêt du
  // lave-vaisselle 12 h 24 (-1 885), arrêt du chauffe-eau 14 h 15 (1 452 -> 356 W).
  const e = (id: number, hh: number, mm: number, d: number, before: number): PowerEvent => ({
    id, ts: at(9, hh, mm), delta_w: d, direction: d > 0 ? "on" : "off", production_power: 0, power_before: before, power_after: before + d,
  });
  const live = [e(9001, 11, 24, 1845, 221), e(9002, 11, 54, 1680, 2066), e(9003, 12, 24, -1885, 3782)];
  const now = new Date(at(9, 12, 45)).getTime();
  const merged = mergeEvents(live);
  const paired = pairSessions(merged, now).sessions;
  assert.equal(paired.some((s) => s.on_event_id === 9001), false, "le chauffe-eau tourne encore à 12 h 45");
  assert.equal(paired.find((s) => s.off_event_id === 9003)?.on_event_id, 9002, "l'arrêt de 12 h 24 revient au lave-vaisselle");
  const named = [{ id: 7, centroid_power_w: 1670, avg_duration_min: 162 }];
  assert.equal(runningSessions(merged, paired, named, now, 1900)[0]?.cluster_id, 7, "toujours compté en direct");
  // Une fois l'arrêt arrivé, la session va bien jusqu'à 14 h 15.
  const done = mergeEvents([...live, e(9004, 14, 15, -1096, 1452)]);
  const s = pairSessions(done, new Date(at(9, 14, 30)).getTime()).sessions.find((x) => x.on_event_id === 9001);
  assert.equal(s?.off_event_id, 9004);
  // Historique complet (fenêtre écoulée) : le rabattement par magnitude reste possible.
  assert.equal(pairSessions(mergeEvents(live)).sessions.find((x) => x.on_event_id === 9001)?.off_event_id, 9003);
});

test("creux d'une minute (relevé à la minute) : pas pris pour l'arrêt du chauffe-eau", () => {
  // 10/10/2026 : chauffe-eau 11 h 30 (500 -> 2 330 W) ; creux 13 h 02 (1 376 -> 947) puis 13 h 03
  // (947 -> 2 171, le chauffe-eau + une bouilloire) ; bouilloire coupée 13 h 05 ; vrai arrêt 14 h 02.
  const e = (id: number, hh: number, mm: number, d: number, before: number): PowerEvent => ({
    id, ts: at(10, hh, mm), delta_w: d, direction: d > 0 ? "on" : "off", production_power: 0, power_before: before, power_after: before + d,
  });
  const events = [
    e(9101, 11, 30, 1830, 500),
    e(9102, 13, 2, -429, 1376),
    e(9103, 13, 3, 1224, 947),
    e(9104, 13, 5, -627, 2214),
    e(9105, 14, 2, -573, 1006),
  ];
  const merged = mergeEvents(events);
  assert.equal(merged.some((x) => x.id === 9102), false, "le creux disparaît");
  const kettle = merged.find((x) => x.id === 9103);
  assert.equal(kettle?.delta_w, 795, "le ON suivant ne garde que ce qui dépasse le creux");
  assert.equal(kettle?.power_before, 1376);
  const heater = pairSessions(merged).sessions.find((s) => s.on_event_id === 9101);
  assert.equal(heater?.off_event_id, 9105, "le chauffe-eau va jusqu'à 14 h 02");
  // Une pointe brève (bouilloire seule) reste un appareil.
  const spike = pairSessions(mergeEvents([e(9201, 8, 30, 1950, 300), e(9202, 8, 32, -1950, 2250)])).sessions;
  assert.equal(spike.length, 1);
});

test("chauffe-eau programmé : compté dès le relevé suivant à son heure habituelle", async () => {
  const { runningSessions, usualStartMinute, localMinute } = await import("../src/lib/nilm/algorithm.ts");
  // Démarrages habituels 11 h 24 – 11 h 34 (heure de Paris).
  const starts = [at(1, 11, 24), at(2, 11, 30), at(3, 11, 34), at(4, 11, 28), at(5, 11, 31)];
  const usual = usualStartMinute(starts);
  assert.equal(usual, 11 * 60 + 30);
  assert.equal(usualStartMinute(starts.slice(0, 3)), null, "trop peu de sessions");
  assert.equal(usualStartMinute([at(1, 8, 0), at(2, 11, 0), at(3, 14, 0), at(4, 17, 0), at(5, 20, 0)]), null, "irrégulier");
  assert.equal(localMinute(at(6, 11, 30)), 690);

  const on = (hh: number, mm: number): PowerEvent => ({
    id: nextId++, ts: at(11, hh, mm), delta_w: 1830, direction: "on", production_power: 0, power_before: 250, power_after: 2080,
  });
  const named = [{ id: 7, centroid_power_w: 1670, avg_duration_min: 162, usual_start_min: usual }];
  const run = (e: PowerEvent, minutesAfter: number) => {
    const merged = mergeEvents([e]);
    return runningSessions(merged, pairSessions(merged).sessions, named, new Date(e.ts).getTime() + minutesAfter * 60000, 2000);
  };
  // 11 h 30, 5 min après : déjà compté, rattrapage de 5 min seulement.
  const early = run(on(11, 30), 5);
  assert.equal(early[0]?.cluster_id, 7);
  assert.equal(early[0]?.elapsed_min, 5);
  // Même puissance à 19 h (four ?) : attend toujours les 30 min de confirmation.
  assert.deepEqual(run(on(19, 0), 5), []);
  assert.equal(run(on(19, 0), 31)[0]?.cluster_id, 7);
});

test("relevé à la minute : fenêtre de fusion de 150 s, 330 s avant le 10 octobre", () => {
  const iso = (s: string) => new Date(s).toISOString();
  // Avant : deux ON à 4 min d'écart = un seul échelon vu sur 2 relevés de 5 min.
  const before = mergeEvents([ev(iso("2026-10-09T08:00:00Z"), 1000), ev(iso("2026-10-09T08:04:00Z"), 800)]);
  assert.equal(before.length, 1);
  // Après : 4 min d'écart = deux appareils ; 2 min = encore le même échelon.
  const after = mergeEvents([
    ev(iso("2026-10-12T08:00:00Z"), 1000),
    ev(iso("2026-10-12T08:04:00Z"), 800),
    ev(iso("2026-10-12T08:06:00Z"), 300),
  ]);
  assert.deepEqual(after.map((e) => e.delta_w), [1000, 1100]);
});

test("fond permanent : moyenne des jours mesurés, étendue aux jours demandés", async () => {
  const { baseLoad } = await import("../src/lib/nilm/baseload.ts");
  const rows = [
    { day: "2026-10-12", base_w: "228.0" },
    { day: "2026-10-13", base_w: 232 },
    { day: "2026-10-14", base_w: null },
    { day: "2026-10-20", base_w: 500 }, // hors semaine
  ];
  const b = baseLoad(rows, ["2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.ok(b);
  assert.equal(b.watts, 230);
  assert.equal(b.measuredDays, 2);
  assert.ok(Math.abs(b.kwh - (230 * 24 * 3) / 1000) < 1e-9);
  assert.equal(baseLoad(rows, ["2026-10-01"]), null);
});

test("heure habituelle : un changement de programme est repris sur les dernières sessions", async () => {
  const { usualStartMinute } = await import("../src/lib/nilm/algorithm.ts");
  const day = (d: number, hh: number, mm: number) => new Date(Date.UTC(2026, 9, d, hh - 2, mm)).toISOString();
  // Avant le passage à l'heure d'hiver du 25/10 (UTC+2 partout).
  const old = Array.from({ length: 15 }, (_, i) => day(i + 1, 11, 30));
  const moved = Array.from({ length: 5 }, (_, i) => day(i + 16, 14, 0));
  assert.equal(usualStartMinute(old), 11 * 60 + 30);
  assert.equal(usualStartMinute([...moved, ...old]), 14 * 60);
});

test("impulsions de thermostat : chaque ON est fermé par le OFF qui le suit, pas par un OFF lointain", () => {
  const iso = (s: string) => new Date(s).toISOString();
  const events: PowerEvent[] = [];
  for (let k = 0; k < 6; k++) {
    const t = Date.parse("2026-10-21T03:58:00Z") + k * 5 * 60000;
    events.push(ev(new Date(t).toISOString(), 330), ev(new Date(t + 60000).toISOString(), -330));
  }
  events.push(ev(iso("2026-10-21T06:46:00Z"), -320)); // OFF d'un autre appareil, plus tard
  const { sessions } = pairSessions(mergeEvents(events));
  assert.equal(sessions.length, 6);
  assert.ok(sessions.every((s) => s.duration_min === 1));
});

test("vidéoprojecteur suivi par HA : une session de même puissance hors de ses heures ne rejoint pas sa carte", async () => {
  const { clusterSessions, deviceContexts } = await import("../src/lib/nilm/algorithm.ts");
  const proj = { id: 15, label: "Vidéo proj · mode 2", centroid_power_w: 460, centroid_log_duration: Math.log(60) };
  const session = (start: string, end: string) => ({
    on_event_id: nextId++, off_event_id: nextId++, start_ts: start, end_ts: end,
    power_w: 460, duration_min: (Date.parse(end) - Date.parse(start)) / 60000, pct_solar: 0,
  });
  const during = session("2026-10-21T19:40:00Z", "2026-10-21T20:40:00Z");
  const off = session("2026-10-21T13:28:00Z", "2026-10-21T14:28:00Z");
  const before = session("2026-10-17T13:28:00Z", "2026-10-17T14:28:00Z"); // avant le suivi : inchangé
  const ctx = deviceContexts(
    [
      { device: "video_proj", ts: "2026-10-19T06:27:00Z", state: "off" },
      { device: "video_proj", ts: "2026-10-21T19:30:00Z", state: "on" },
      { device: "video_proj", ts: "2026-10-21T21:00:00Z", state: "off" },
    ],
    Date.parse("2026-10-22T00:00:00Z"),
  );
  const out = clusterSessions([during, off, before], [proj], ctx).sessions;
  assert.equal(out[0].cluster_key, "id:15");
  assert.notEqual(out[1].cluster_key, "id:15");
  assert.equal(out[2].cluster_key, "id:15");
});

test("deux résistances coupées ensemble : une seule baisse ferme les deux sessions", () => {
  const iso = (s: string) => new Date(s).toISOString();
  const e = (t: string, before: number, after: number): PowerEvent => ({ ...ev(iso(t), after - before), power_before: before, power_after: after });
  const events = [
    e("2026-10-23T09:52:30Z", 199, 1988),
    e("2026-10-23T09:55:30Z", 1939, 3795),
    e("2026-10-23T09:56:30Z", 3795, 338),
    e("2026-10-23T10:08:30Z", 279, 2277),
    e("2026-10-23T10:18:40Z", 2135, 236),
  ];
  const { sessions } = pairSessions(mergeEvents(events));
  assert.deepEqual(
    sessions.map((s) => [s.start_ts.slice(11, 16), s.end_ts.slice(11, 16)]),
    [["09:52", "09:56"], ["09:55", "09:56"], ["10:08", "10:18"]],
  );
});

test("heure habituelle : désactivée tant que les dernières chauffes ne suivent pas la médiane", async () => {
  const { usualStartMinute } = await import("../src/lib/nilm/algorithm.ts");
  const day = (d: number, hh: number, mm: number) => new Date(Date.UTC(2026, 9, d, hh - 2, mm)).toISOString();
  const starts = [13, 14, 15, 16, 17, 18].map((d) => day(d, 11, 30)).concat([day(19, 14, 45), day(20, 14, 44)]);
  assert.equal(usualStartMinute(starts), null);
});

test("chauffe mesurée par la prise du lave-vaisselle : elle ne peut plus aller dans la carte du four", async () => {
  const { clusterSessions, deviceContexts } = await import("../src/lib/nilm/algorithm.ts");
  const four = { id: 9, label: "Cuisine · Four préchauffe", centroid_power_w: 1900, centroid_log_duration: Math.log(15) };
  const lv = { id: 70, label: "Lave-vaisselle · chauffe", centroid_power_w: 2150, centroid_log_duration: Math.log(12) };
  const session = (start: string, end: string, w: number) => ({
    on_event_id: nextId++, off_event_id: nextId++, start_ts: start, end_ts: end,
    power_w: w, duration_min: (Date.parse(end) - Date.parse(start)) / 60000, pct_solar: 0,
  });
  const chauffe = session("2026-10-23T12:07:30Z", "2026-10-23T12:22:30Z", 2100);
  const fourSeul = session("2026-10-23T17:00:00Z", "2026-10-23T17:15:00Z", 1900);
  const ctx = deviceContexts(
    [
      { device: "lave_vaisselle", ts: "2026-10-23T12:07:35Z", state: "on" },
      { device: "lave_vaisselle", ts: "2026-10-23T12:22:33Z", state: "off" },
    ],
    Date.parse("2026-10-24T00:00:00Z"),
  );
  assert.equal(clusterSessions([chauffe, fourSeul], [four], ctx).sessions[0].cluster_key, null);
  const out = clusterSessions([chauffe, fourSeul], [four, lv], ctx).sessions;
  assert.equal(out[0].cluster_key, "id:70");
  assert.equal(out[1].cluster_key, "id:9");
});

test("OFF partagé : les off_event_id restent uniques (contrainte de la base)", () => {
  const iso = (s: string) => new Date(s).toISOString();
  const e = (t: string, before: number, after: number): PowerEvent => ({ ...ev(iso(t), after - before), power_before: before, power_after: after });
  const { sessions } = pairSessions(mergeEvents([
    e("2026-10-23T09:52:30Z", 199, 1988),
    e("2026-10-23T09:55:30Z", 1939, 3795),
    e("2026-10-23T09:56:30Z", 3795, 338),
  ]));
  assert.equal(sessions.length, 2);
  assert.equal(new Set(sessions.map((s) => s.off_event_id)).size, 2);
});

test("compteur en direct : une chauffe mesurée par la prise du lave-linge n'est pas comptée comme chauffe-eau", async () => {
  const { runningSessions, deviceContexts } = await import("../src/lib/nilm/algorithm.ts");
  const iso = (s: string) => new Date(s).toISOString();
  const on: PowerEvent = { ...ev(iso("2026-10-24T15:02:00Z"), 2000), power_before: 400, power_after: 2400 };
  const named = [{ id: 7, centroid_power_w: 1900, avg_duration_min: 150, usual_start_min: null }];
  const now = Date.parse("2026-10-24T15:45:00Z");
  assert.equal(runningSessions([on], [], named, now).length, 1);
  const ctx = deviceContexts([{ device: "lave_linge", ts: "2026-10-24T15:01:30Z", state: "on" }], now);
  assert.equal(runningSessions([on], [], named, now, null, ctx).length, 0);
});

test("prises : kWh mesurés sommés sur les jours demandés, NILM remplacé seulement si toute la période est couverte", async () => {
  const { measuredDevices } = await import("../src/lib/nilm/measured.ts");
  const rows = [
    { day: "2026-10-23", measured: { lave_vaisselle: 1.64 } },
    { day: "2026-10-24", measured: { lave_vaisselle: "1.8", coin_cinema: 0.9 } },
    { day: "2026-10-25", measured: null },
  ];
  const m = measuredDevices(rows, ["2026-10-23", "2026-10-24"]);
  assert.deepEqual(m.map((d) => [d.key, d.kwh, d.since, d.complete]), [
    ["lave_vaisselle", 3.44, "2026-10-23", true],
    ["coin_cinema", 0.9, "2026-10-24", false],
  ]);
  assert.ok(m[0].replaces.test("Lave-vaisselle · chauffe"));
  assert.ok(m[1].replaces.test("Vidéo proj · mode 1"));
  assert.deepEqual(measuredDevices(rows, ["2026-10-25"]), []);
});

test("compteurs HA corrigés : remplacent le NILM seulement s'ils couvrent toute la période", async () => {
  const { measuredDevices, withoutMeasured } = await import("../src/lib/nilm/measured.ts");
  const rows = [
    { day: "2026-11-07", measured: { ha_chauffe_eau_haut: 3.78, ha_thermodynamique: 2.08 } },
    { day: "2026-11-08", measured: { ha_chauffe_eau_haut: 4.25 } },
  ];
  const m = measuredDevices(rows, ["2026-11-07", "2026-11-08"]);
  assert.deepEqual(m.map((d) => [d.key, d.kwh, d.source, d.complete]), [["ha_chauffe_eau_haut", 8.03, "ha", true]]);
  const groups = [{ label: "Chauffe-eau en haut" }, { label: "Chauffe-eau thermodynamique" }, { label: "Lave-linge" }];
  assert.deepEqual(withoutMeasured(groups, m).map((g) => g.label), ["Chauffe-eau thermodynamique", "Lave-linge"]);
});

test("puissance maison actuelle : soutirage + production, inconnue en injection ou sans courbe récente", async () => {
  const { housePowerNow, effectiveProductionW } = await import("../src/lib/nilm/algorithm.ts");
  const t = Date.parse("2026-11-10T13:00:00Z");
  const pts = (rows: [number, number | null][]): [number, number, number | null][] => rows.map(([c, p], i) => [t - (rows.length - 1 - i) * 7000, c, p]);
  assert.equal(housePowerNow(pts([[1900, 0], [1905, 0]]), t), 1905);
  assert.equal(Math.round(housePowerNow(pts([[1300, 900], [1100, 1100]]), t)!), Math.round(1100 + effectiveProductionW(1100)));
  assert.equal(effectiveProductionW(120), 0, "plancher de la pince production");
  assert.equal(housePowerNow(pts([[279, 400], [279, 450], [279, 500], [279, 520]]), t), null, "conso figée sous production : injection");
  assert.equal(housePowerNow(pts([[250, 0], [250, 0], [250, 0], [250, 0]]), t), 250, "valeurs identiques la nuit : pas un gel");
  assert.equal(housePowerNow(pts([[1900, 0]]), t + 6 * 60000), null, "courbe trop vieille");
  assert.equal(housePowerNow([], t), null);
});

test("lave-linge : cycle reconnu à l'agitation du tambour, états on/off émis une seule fois", async () => {
  const { washerWindows, washerStates } = await import("../src/lib/nilm/algorithm.ts");
  const t0 = Date.parse("2026-11-04T09:00:00Z");
  const pts: [number, number, number | null][] = [];
  // 1 h 30 calme (±5 W), 1 h 30 de brassage (±110 W d'un relevé à l'autre) avec 10 min de
  // trempage calme au milieu, puis 40 min calmes. Un point toutes les 7 s.
  for (let i = 0; i * 7000 < 220 * 60000; i++) {
    const min = (i * 7) / 60;
    const drum = min >= 90 && min < 180 && !(min >= 130 && min < 140);
    pts.push([t0 + i * 7000, 400 + (drum ? (i % 2 ? 110 : 0) : i % 2 ? 5 : 0), 0]);
  }
  const w = washerWindows(pts);
  assert.equal(w.length, 1);
  assert.equal(new Date(w[0].start).toISOString(), "2026-11-04T10:25:00.000Z", "une tranche avant le début du brassage");
  assert.equal(new Date(w[0].end).toISOString(), "2026-11-04T12:00:00.000Z");
  const last = pts[pts.length - 1][0];
  const states = washerStates(w, [], last);
  assert.deepEqual(states.map((s) => [s.device, s.state, s.ts]), [
    ["lave_linge", "on", "2026-11-04T10:25:00.000Z"],
    ["lave_linge", "off", "2026-11-04T12:00:00.000Z"],
  ]);
  assert.deepEqual(washerStates(w, states, last), [], "déjà enregistrés : rien à ajouter");
  // En cours de cycle : « on » dès 30 min de brassage, pas encore de « off ».
  const partial = pts.filter((p) => p[0] <= t0 + 125 * 60000);
  const live = washerStates(washerWindows(partial), [], partial[partial.length - 1][0]);
  assert.deepEqual(live.map((s) => s.state), ["on"]);
  // Moins de 30 min d'agitation (une chauffe de four qui régule, un aspirateur) : pas un cycle.
  assert.deepEqual(washerWindows(pts.filter((p) => p[0] <= t0 + 110 * 60000)), []);
  // Soleil qui varie sans brassage : la production compense le soutirage, pas d'agitation.
  const sun = pts.map(([t], i): [number, number, number | null] => [t, 1500 - (i % 2 ? 300 : 0), 900 + (i % 2 ? 300 : 0)]);
  assert.deepEqual(washerWindows(sun), []);
});

test("lave-linge programme doux : trois chauffes brèves qui se suivent, pas deux bouilloires", async () => {
  const { washerCycleSessions } = await import("../src/lib/nilm/algorithm.ts");
  const mk = (start: string, min: number, w: number, id: number) => {
    const a = Date.parse(`2026-11-11T${start}Z`);
    return { on_event_id: id, off_event_id: id + 1000, start_ts: new Date(a).toISOString(), end_ts: new Date(a + min * 60000).toISOString(), power_w: w, duration_min: min, pct_solar: 0 };
  };
  // 11/11/2026 : 10:19 (3,0 min), 10:29 (2,3 min), 10:44 (1,3 min), puis une vraie bouilloire à 11:15.
  const cycle = [mk("09:19:25", 3.0, 1837, 1), mk("09:29:34", 2.3, 1773, 2), mk("09:44:30", 1.3, 1702, 3), mk("10:15:39", 1.6, 1964, 4)];
  assert.deepEqual([...washerCycleSessions(cycle).heats].sort(), [0, 1, 2], "la bouilloire 31 min plus tard n'en fait pas partie");
  // Deux bouilloires à 10 min d'écart, ou trois étalées sur la matinée : pas un cycle.
  assert.equal(washerCycleSessions([mk("07:00:00", 2.5, 2000, 1), mk("07:12:00", 2.0, 2000, 2)]).heats.size, 0);
  assert.equal(washerCycleSessions([mk("07:00:00", 2.5, 2000, 1), mk("07:40:00", 2.0, 2000, 2), mk("08:20:00", 2.0, 2000, 3)]).heats.size, 0);
});

test("thermodynamique par défaut : 2 kWh par jour, à 250 W de 11 h à 19 h heure de Paris", async () => {
  const { thermoDefaultKwh } = await import("../src/lib/nilm/measured.ts");
  const at = (iso: string) => Date.parse(iso);
  assert.equal(thermoDefaultKwh(at("2026-11-10T20:00:00Z")), 0, "avant la mise en place");
  assert.equal(thermoDefaultKwh(at("2026-11-11T09:59:00Z")), 0, "10 h 59 à Paris");
  assert.equal(thermoDefaultKwh(at("2026-11-11T14:00:00Z")), 1.0, "15 h : 4 h de plage");
  assert.equal(thermoDefaultKwh(at("2026-11-11T20:00:00Z")), 2.0);
  assert.equal(thermoDefaultKwh(at("2026-11-12T08:00:00Z")), 2.0, "le lendemain matin");
  assert.equal(thermoDefaultKwh(at("2026-11-13T12:00:00Z")), 4.5);
  assert.equal(thermoDefaultKwh(at("2027-03-29T16:00:00Z")), 277.75, "heure d'été : 18 h à Paris");
});

test("plausibilité : la somme des sessions en cours ne dépasse pas la maison au-dessus de son fond", async () => {
  const { houseLevels, implausibleSessions, runPipeline, PLAUSIBLE } = await import("../src/lib/nilm/algorithm.ts");
  const t0 = Date.parse("2026-11-09T12:00:00Z");
  // 4 h de courbe : fond 200 W, un chauffe-eau de 1 800 W de 12:30 à 14:00, un appareil de 110 W de 14:30 à 15:00.
  const pts: [number, number, number | null][] = [];
  for (let t = t0; t < t0 + 4 * 3600000; t += 7000) {
    const m = (t - t0) / 60000;
    pts.push([t, 200 + (m >= 30 && m < 120 ? 1800 : 0) + (m >= 150 && m < 180 ? 110 : 0), 0]);
  }
  const mk = (id: number, from: number, to: number, w: number) => ({ on_event_id: id, off_event_id: id + 1000, start_ts: new Date(t0 + from * 60000).toISOString(), end_ts: new Date(t0 + to * 60000).toISOString(), power_w: w, duration_min: to - from, pct_solar: 0 });
  const heater = mk(1, 30, 120, 1800), real = mk(2, 150, 180, 110);
  const ghost = mk(3, 160, 235, 110); // se poursuit 55 min après le retour au fond
  const twin = mk(4, 151, 179, 115); // même créneau que l'appareil réel : un seul des deux existe
  const short = mk(5, 10, 13, 2000); // trop courte pour être jugée
  const levels = houseLevels(pts, []);
  assert.deepEqual(implausibleSessions([heater, real], levels), []);
  assert.deepEqual(implausibleSessions([heater, real, ghost, twin, short], levels).sort(), [2, 3], "le jumeau le plus puissant est gardé, le fantôme rejeté");
  assert.deepEqual(implausibleSessions([heater, ghost], levels, new Set([3])), [], "déjà rejetée : ignorée");
  // Prise mesurée retirée du niveau : une session de 2 kW pendant une chauffe du lave-vaisselle est impossible.
  const plug = [{ device: "prise:lave_vaisselle", ts: new Date(t0 + 200 * 60000).toISOString(), state: "2000" }, { device: "prise:lave_vaisselle", ts: new Date(t0 + 215 * 60000).toISOString(), state: "30" }];
  const withPlug = pts.map(([t, c, p]): [number, number, number | null] => [t, c + (t >= t0 + 200 * 60000 && t < t0 + 215 * 60000 ? 2000 : 30), p]);
  assert.deepEqual(implausibleSessions([mk(6, 201, 214, 1900)], houseLevels(withPlug, plug)), [6]);
  // Le pipeline écarte les sessions marquées dans device_states.
  const ev = (id: number, min: number, d: number) => ({ id, ts: new Date(t0 + min * 60000).toISOString(), delta_w: d, power_before: 200, power_after: 200 + d, direction: (d > 0 ? "on" : "off") as "on" | "off", production_power: 0 });
  const events = [ev(10, 10, 1500), ev(11, 25, -1500)];
  assert.equal(runPipeline(events, [], t0 + 3600000).sessions.length, 1);
  assert.equal(runPipeline(events, [], t0 + 3600000, [], [{ device: PLAUSIBLE.device, ts: events[0].ts, state: "10" }]).sessions.length, 0);
});

test("doublon : deux sessions d'une même carte qui se recouvrent, on garde la plus proche de la signature", () => {
  const iso = (s: string) => new Date(s).toISOString();
  // Thermodynamique du 21/10/2026 : deux appariements croisés pour un seul appareil.
  const events: PowerEvent[] = [
    ev(iso("2026-10-21T13:20:00Z"), 717),
    ev(iso("2026-10-21T13:44:00Z"), 512),
    ev(iso("2026-10-21T15:08:00Z"), -717),
    ev(iso("2026-10-21T16:00:00Z"), -512),
  ];
  const thermo = { id: 57, label: "Chauffe-eau Thermodynamique", centroid_power_w: 599, centroid_log_duration: Math.log(160) };
  const { sessions } = runPipeline(events, [thermo]);
  const named = sessions.filter((s) => s.cluster_key === "id:57");
  assert.equal(named.length, 1);
  assert.equal(Math.round(named[0].power_w), 512);
});

test("courbe à 7 s : les impulsions d'un four en régulation restent des sessions courtes", () => {
  nextId = 1;
  const saved = PARAMS.fineSamplingSince;
  PARAMS.fineSamplingSince = at(2, 0);
  try {
    // 2,3 kW pendant 7 s toutes les 70 s, trois fois.
    const events = [0, 70, 140].flatMap((s) => {
      const on = new Date(Date.parse(at(2, 18)) + s * 1000);
      const off = new Date(on.getTime() + 7000);
      return [lev(on.toISOString(), 1240, 3540), lev(off.toISOString(), 3540, 1240)];
    });
    const { sessions } = pairSessions(mergeEvents(events));
    assert.equal(sessions.length, 3);
    assert.ok(sessions.every((x) => x.duration_min < 0.2));
  } finally {
    PARAMS.fineSamplingSince = saved;
  }
});

test("courbe à 7 s : l'arrêt d'une impulsion lui est réservé, un appareil plus ancien ne le prend pas", () => {
  nextId = 1;
  const saved = PARAMS.fineSamplingSince;
  PARAMS.fineSamplingSince = at(2, 0);
  try {
    const events = [
      lev(at(2, 12, 23), 100, 395), // petit appareil (~295 W), arrêt bien plus tard
      lev(at(2, 15, 56), 1350, 1740), // impulsion de 7 s, +390 W
      lev(new Date(Date.parse(at(2, 15, 56)) + 7000).toISOString(), 1740, 1352),
      lev(at(2, 17, 47), 1200, 596), // arrêt de −604 W, sans rapport
    ];
    const { sessions } = pairSessions(mergeEvents(events), Date.parse(at(3, 0)));
    const pulse = sessions.find((s) => s.start_ts === at(2, 15, 56));
    assert.ok(pulse);
    assert.ok(pulse.duration_min < 0.2);
  } finally {
    PARAMS.fineSamplingSince = saved;
  }
});

test("prises mesurées : leurs échelons sont retirés de ceux de la maison", async () => {
  const { subtractPlugs } = await import("../src/lib/nilm/algorithm.ts");
  nextId = 1;
  const states = [
    { device: "prise:lave_vaisselle", ts: at(3, 12, 0), state: "2" },
    { device: "prise:lave_vaisselle", ts: new Date(Date.parse(at(3, 12, 15)) - 10000).toISOString(), state: "1790" },
    { device: "prise:lave_vaisselle", ts: at(3, 12, 29), state: "45" },
  ];
  const events = [
    lev(at(3, 12, 15), 300, 2090), // chauffe du lave-vaisselle vue par la maison
    lev(at(3, 12, 22), 2090, 3790), // bouilloire pendant la chauffe
    lev(at(3, 12, 29), 3790, 2045), // fin de chauffe
  ];
  const out = subtractPlugs(mergeEvents(events), states);
  assert.equal(out.length, 1);
  assert.equal(out[0].delta_w, 1700);
  assert.equal(out[0].power_before, 300);
});

test("« C'était quoi ? » : sessions récentes et significatives des cartes sans nom seulement", async () => {
  const { toIdentify } = await import("../src/lib/nilm/identify.ts");
  const now = Date.parse("2026-11-01T10:00:00Z");
  const s = (cluster_id: number | null, start: string, power_w: number, duration_min: number) => ({
    cluster_id, start_ts: start, end_ts: start, power_w, duration_min,
  });
  const out = toIdentify(
    [
      s(186, "2026-10-31T12:23:00Z", 295, 213), // sans nom, récente : gardée
      s(188, "2026-11-01T08:02:00Z", 330, 3), // nommée : écartée
      s(190, "2026-10-31T15:00:00Z", 2300, 0.1), // impulsion de 7 s, < 0,05 kWh : écartée
      s(null, "2026-10-31T20:00:00Z", 900, 30), // isolée : écartée
      s(177, "2026-10-29T09:00:00Z", 900, 30), // trop ancienne : écartée
      s(182, "2026-11-01T08:42:00Z", 335, 18), // sans nom, la plus récente : en tête
    ],
    new Set([188]),
    now,
  );
  assert.deepEqual(out.map((x) => x.cluster_id), [182, 186]);
});

/** Une session déjà appariée, début à `startS` secondes après 18 h le 2. */
function sess(startS: number, durS: number, watts = 2140): Session {
  const a = Date.parse(at(2, 18)) + startS * 1000;
  nextId += 2;
  return {
    on_event_id: nextId - 2,
    off_event_id: nextId - 1,
    start_ts: new Date(a).toISOString(),
    end_ts: new Date(a + durS * 1000).toISOString(),
    power_w: watts,
    duration_min: durS / 60,
    pct_solar: 0,
  };
}
/** Série du fer du 01/11/2026 : impulsions de 6 à 90 s, une toutes les ~140 s. */
const ironTrain = (offsetS = 0) => [30, 6, 66, 12, 48, 42, 90, 24].map((d, k) => sess(offsetS + k * 140, d));

test("fer à repasser : une série d'impulsions espacées est reconnue", () => {
  assert.equal(pulseTrainSessions(ironTrain()).size, 8);
  assert.equal(pulseTrainSessions(ironTrain().slice(0, 5)).size, 0); // trop courte
  // Repassage serré du 01/11/2026 vers 20 h 50 : une impulsion toutes les ~42 s, irrégulière.
  const fast = [0, 224, 266, 378, 420, 462, 511, 553, 595].map((t, k) => sess(t, [66, 24, 24, 12, 6, 24, 24, 24, 12][k]));
  assert.equal(pulseTrainSessions(fast).size, 9);
});

test("fer à repasser : la régulation d'un four (7 s toutes les 70 s) ou une série après préchauffe n'en est pas", () => {
  const oven = Array.from({ length: 20 }, (_, k) => sess(k * 70, 7));
  assert.equal(pulseTrainSessions(oven).size, 0);
  const preheat = sess(-20 * 60, 15 * 60, 2200); // 15 min à pleine puissance, finie 5 min avant
  assert.equal(pulseTrainSessions([preheat, ...ironTrain()]).size, 0);
});

test("fer à repasser : la série va à sa carte, une impulsion isolée reste au four", () => {
  const existing: ExistingCluster[] = [
    { id: 50, label: "Four · impulsions 2 kW", centroid_power_w: 2200, centroid_log_duration: Math.log(0.3) },
    { id: 60, label: "Fer à repasser", centroid_power_w: 2140, centroid_log_duration: Math.log(0.5) },
  ];
  const lone = sess(-3 * 3600, 20);
  const out = clusterSessions([lone, ...ironTrain()], existing).sessions;
  assert.equal(out[0].cluster_key, "id:50");
  assert.ok(out.slice(1).every((x) => x.cluster_key === "id:60"));
});

// Creux solaire du 03/11/2026 : conso qui plonge quand la production saute, chauffe-eau toujours en marche.
function step(id: number, at: string, before: number, after: number, production: number): PowerEvent {
  return {
    id,
    ts: `2026-11-03T${at}Z`,
    delta_w: after - before,
    power_before: before,
    power_after: after,
    direction: after > before ? "on" : "off",
    production_power: production,
  };
}

test("creux solaire : le chauffe-eau reste en marche, les à-coups ne font pas de sessions", () => {
  const { sessions } = pairSessions(
    [
      step(1, "13:00:00", 400, 2100, 200),
      step(2, "13:38:00", 2000, 800, 1300), // le soleil perce
      step(3, "13:40:00", 800, 1100, 1200), // à-coup
      step(4, "13:42:00", 1100, 1800, 400), // la puissance revient
      step(5, "15:29:00", 2100, 350, 150), // vrai arrêt
      step(6, "15:40:00", 350, 650, 150),
      step(7, "15:50:00", 650, 350, 150),
    ],
    Date.parse("2026-11-03T18:00:00Z"),
  );
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].end_ts, "2026-11-03T15:29:00Z");
  assert.equal(sessions[1].on_event_id, 6);
});

test("soleil sous le chauffe-eau : sa puissance reste celle du départ, les à-coups ne font pas d'appareil", () => {
  const { sessions } = pairSessions(
    [
      step(1, "13:00:00", 150, 1600, 660),
      step(2, "13:02:00", 1400, 900, 1500), // le soleil perce : aucun appareil ne s'arrête
      step(3, "13:40:00", 1000, 1300, 1250),
      step(4, "13:41:00", 1300, 1290, 600),
      step(5, "14:10:00", 1290, 990, 1000),
      step(6, "15:30:00", 2040, 280, 200), // vrai arrêt, plus fort que le départ : moins de solaire
    ],
    Date.parse("2026-11-03T18:00:00Z"),
  );
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].power_w, 1450);
  assert.equal(sessions[0].end_ts, "2026-11-03T15:30:00Z");
});

test("niveau négatif après déduction des prises : le retour au niveau reste reconnu", () => {
  const { sessions } = pairSessions(
    [step(1, "15:33:33", -308, 1763, 120), step(2, "15:35:18", 1746, 243, 120), step(3, "17:14:07", 885, 191, 0)],
    Date.parse("2026-11-03T20:00:00Z"),
  );
  assert.equal(sessions[0].end_ts, "2026-11-03T15:35:18Z");
});

const sunBreaks = [step(1, "13:00:00", 400, 2100, 200), step(2, "13:37:00", 2100, 2000, 300), step(3, "13:38:00", 2000, 500, 1300)];

test("creux solaire : sans reprise, l'arrêt est un vrai arrêt", () => {
  const { sessions } = pairSessions(sunBreaks, Date.parse("2026-11-03T18:00:00Z"));
  assert.equal(sessions[0].end_ts, "2026-11-03T13:38:00Z");
});

test("creux solaire : pendant la fenêtre de reprise, l'appareil tourne toujours", () => {
  assert.equal(pairSessions(sunBreaks, Date.parse("2026-11-03T13:45:00Z")).sessions.length, 0);
});

test("creux solaire : sans saut de production, le retour au niveau reste un arrêt", () => {
  const { sessions } = pairSessions(
    [step(1, "13:00:00", 400, 2100, 200), step(2, "13:38:00", 2000, 500, 250), step(3, "13:42:00", 500, 2300, 250), step(4, "13:50:00", 2300, 450, 250)],
    Date.parse("2026-11-03T18:00:00Z"),
  );
  assert.equal(sessions[0].end_ts, "2026-11-03T13:38:00Z");
});

// Cycle du 04/11/2026 : secondes depuis le début du cycle.
const NOV = 63 * 86400; // sess() part de septembre, la règle ne vaut que sur la courbe à 7 s
const washerRun = (offsetS = NOV) => [
  sess(offsetS, 9 * 60, 1996),
  sess(offsetS + 14 * 60, 17 * 60, 2027),
  sess(offsetS + 68 * 60, 5 * 60, 1857),
  ...[104, 108, 110, 112, 115, 118, 122].map((m) => sess(offsetS + m * 60, 50, 800)),
];

test("lave-linge : chauffes puis essorage = un cycle", () => {
  const { heats, spins } = washerCycleSessions(washerRun());
  assert.deepEqual([...heats].sort(), [0, 1, 2]);
  assert.equal(spins.size, 7);
});

test("lave-linge : pas d'essorage, ou trop tôt, ou sans chauffe = pas un cycle", () => {
  assert.equal(washerCycleSessions(washerRun().slice(0, 3)).heats.size, 0);
  assert.equal(washerCycleSessions(washerRun().slice(0, 7)).heats.size, 0); // 4 à-coups seulement
  assert.equal(washerCycleSessions(washerRun().slice(3)).spins.size, 0);
  const justAfter = [sess(NOV, 10 * 60, 2000), ...[12, 14, 16, 18, 20].map((m) => sess(NOV + m * 60, 50, 800))];
  assert.equal(washerCycleSessions(justAfter).heats.size, 0); // four puis micro-onde, 2 min plus tard
  assert.equal(washerCycleSessions(washerRun(0)).heats.size, 0); // avant la courbe à 7 s
});

test("lave-linge : les chauffes vont à sa carte, l'essorage quitte le micro-onde", () => {
  const existing: ExistingCluster[] = [
    { id: 12, label: "Four · pleine puissance", centroid_power_w: 2229, centroid_log_duration: Math.log(11) },
    { id: 52, label: "Micro-onde · court", centroid_power_w: 930, centroid_log_duration: Math.log(1) },
    { id: 55, label: "Lave-linge · chauffe", centroid_power_w: 1981, centroid_log_duration: Math.log(35) },
  ];
  const oven = sess(NOV - 6 * 3600, 11 * 60, 2229);
  const out = clusterSessions([oven, ...washerRun()], existing).sessions;
  assert.equal(out[0].cluster_key, "id:12");
  assert.ok(out.slice(1, 4).every((x) => x.cluster_key === "id:55"));
  assert.ok(out.slice(4).every((x) => x.cluster_key !== "id:52"));
});
