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
