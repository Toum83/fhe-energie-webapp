// NILM (étape 2) : événements ON/OFF bruts -> sessions -> clusters d'appareils.
// Fonctions pures, sans dépendance (testées par webapp/tests/nilm.test.ts).
//
// Principe : un appareil a une signature (puissance, durée). L'heure du jour n'est
// JAMAIS une caractéristique de regroupement : si un lave-linge est déplacé vers les
// heures solaires, il doit rester le même appareil.

export type PowerEvent = {
  id: number;
  ts: string; // ISO
  delta_w: number;
  /** Puissance juste avant / juste après l'échelon (absente des anciennes versions de nilm_get_events). */
  power_before?: number | null;
  power_after?: number | null;
  direction: "on" | "off";
  production_power: number | null;
};

export type Session = {
  on_event_id: number;
  off_event_id: number;
  start_ts: string;
  end_ts: string;
  power_w: number;
  duration_min: number;
  /**
   * Part estimée de la consommation de l'appareil couverte par le solaire (0..1) :
   * production / puissance de l'appareil, plafonnée à 1, moyennée sur le démarrage et l'arrêt.
   * Estimation haute : les autres appareils en marche se partagent aussi la production.
   */
  pct_solar: number;
};

export type ExistingCluster = {
  id: number;
  label: string | null;
  centroid_power_w: number;
  centroid_log_duration: number;
};

export type NewCluster = {
  /** id d'un cluster existant réutilisé, ou null pour un nouveau. */
  id: number | null;
  /** Clé locale pour rattacher les sessions : "id:<n>" ou "new:<n>". */
  key: string;
  centroid_power_w: number;
  centroid_log_duration: number;
  avg_duration_min: number;
  occurrences: number;
  avg_pct_solar: number;
  hourly: number[]; // 24 cases, heure locale de début de session
  first_seen: string;
  last_seen: string;
};

export type ClusteringResult = {
  sessions: (Session & { cluster_key: string | null })[];
  clusters: NewCluster[];
  /** Ids de clusters existants sans nom qui n'existent plus : à supprimer. */
  delete_ids: number[];
  stats: { events: number; merged_events: number; sessions: number; unpaired: number; noise: number };
};

export const PARAMS = {
  /**
   * Deux événements de même sens à moins de ça sont un seul échelon étalé sur 2 relevés.
   * 330 s quand HA relevait toutes les 5 min, 150 s depuis le relevé à la minute
   * (voir minutePollingSince) : deux appareils allumés à 3 min d'écart restent distincts.
   */
  mergeWindowS: 330,
  mergeWindowMinuteS: 150,
  /** Passage de fhe_solar au relevé à la minute. */
  minutePollingSince: "2026-10-10T09:14:00Z",
  /**
   * Passage aux échelons tirés de la courbe FHE à 7 s (fhe_solar 0.4.0, déjà regroupés par
   * l'intégration) : fusion et creux ramenés à 20 s. Avec 150 s, les impulsions d'un four en
   * régulation (7 s toutes les 70 s, 31/10/2026) passaient pour des creux et formaient une seule
   * longue chauffe. Début de la courbe à 7 s rattrapée (supabase/backfill_2026-10-31_7s.sql), juste
   * avant l'installation de la 0.4.0.
   */
  fineSamplingSince: "2026-10-31T14:54:56Z" as string | null,
  fineWindowS: 20,
  /** Courbe à 7 s : un ON suivi d'un OFF de même amplitude en moins de ça est une impulsion (voir pairSessions). */
  pulseMaxS: 120,
  /**
   * Courbe à 7 s : seuil de détection abaissé à 80 W (input_number.nilm_event_threshold_w, 31/10/2026 ;
   * démarrage d'un PC à +115 W). La tolérance d'appariement absolue suit : 250 W laissait un ON de
   * 100 W prendre un OFF de 340 W.
   */
  fineMinStepW: 80,
  pairAbsTolFineW: 80,
  /** Au-delà, un ON sans OFF correspondant est abandonné. */
  pairWindowS: 4 * 3600,
  /** Tolérance de magnitude entre un ON et son OFF : max(35 % du ON, 250 W). */
  pairRelTol: 0.35,
  pairAbsTolW: 250,
  /** Un ON immédiatement suivi d'un OFF de même amplitude est apparié à ce OFF (voir pairSessions). */
  pairNextOff: true,
  /** Part de la plus courte au-delà de laquelle deux sessions d'une même carte sont un doublon. */
  selfOverlapMax: 0.5,
  /**
   * Gros appareils : à partir de ce ON, l'arrêt est reconnu au retour au niveau d'avant le
   * démarrage (± max(25 %, 150 W)), même s'il se fait en plusieurs paliers. Cas typique : un
   * chauffe-eau dont la puissance décroît avant de couper. Validé sur les données réelles du
   * 25/09 au 02/10/2026 : chauffe-eau 4 → 7 sessions, autres appareils inchangés ; les petits
   * appareils gardent l'appariement par magnitude (le retour au niveau les dégradait).
   */
  levelPairMinW: 1000,
  /**
   * Session longue (>= 60 min) à arrêt par retour au niveau : si un arrêt survient dans les
   * 20 premières minutes et laisse un surplus entre 30 % et 90 % du saut de départ, c'est un autre
   * appareil, démarré en même temps, qui vient de s'arrêter : ce surplus est la vraie puissance.
   * Cas réel du 04/10/2026 : chauffe-eau + bouilloire = saut de 3 866 W, puis la bouilloire coupe
   * et laisse 1 653 W. Validé sur le 25/09 → 04/10/2026 : chauffe-eau 9 sessions au lieu de 8 avec
   * la carte nommée, autres appareils identiques. (Une médiane du surplus sur toute la session a été
   * écartée : la puissance du chauffe-eau décroît pendant la chauffe, la médiane le sous-estimait.)
   */
  revealMinMinutes: 60,
  revealWindowMin: 20,
  revealMinRatio: 0.3,
  revealMaxRatio: 0.9,
  levelRelTol: 0.25,
  levelAbsTolW: 150,
  /** Echelles fixes (pas des z-scores recalculés : le sens d'eps ne doit pas dériver avec le volume). */
  powerLogScale: 0.25, // ±25 % de puissance
  durationLogScale: 0.7, // facteur ~2 sur la durée
  /** Un cluster nommé absorbe une session si sa distance normalisée <= 1. */
  assignRadius: 1,
  /**
   * Regroupement des sessions non reconnues. 1 / 3 convenait aux relevés de 5 min ; à la minute,
   * les sessions sont 2 fois plus nombreuses (impulsions de thermostat, four) et s'enchaînaient
   * de proche en proche en une seule carte de 205 à 4 272 W (229 sessions, 21/10/2026).
   * 0,5 / 4 donne 13 cartes compactes sur le même historique, sans toucher aux cartes nommées.
   */
  dbscanEps: 0.5,
  dbscanMinPts: 4,
  /** Reprise d'un cluster non nommé existant si son centroïde est à <= 1. */
  reuseRadius: 1,
  timeZone: "Europe/Paris",
  /**
   * Passage de fhe_solar aux échelons de la puissance MAISON (0.6.0). La pince « Consommation » de
   * FHE mesure le soutirage (maison − production) : constaté le 10/11/2026, pente Δconso/Δprod de
   * −0,96 à −0,99, et conso inférieure à la prise du lave-vaisselle seule au soleil. Depuis cette
   * date, power_before / power_after / delta_w des événements sont ceux de la maison reconstruite
   * (soutirage + production, niveau maintenu pendant l'injection). Rejeu du 02 au 10/11/2026 :
   * petites séances de 10 h à 17 h les jours de soleil 42 → 23 (7,5 → 3,4 kWh), échelons non
   * appariés 437 → 358, et les règles de creux solaire ci-dessous n'ont plus aucun effet (elles
   * restent pour les événements d'avant). Installée le 10/11/2026 à 22 h 53 (redémarrage de HA).
   */
  houseSignalSince: "2026-11-10T21:53:00Z" as string | null,
  /** Lecture de la pince « Production » sans puissance réelle (onduleur sous tension), retirée en quadrature. */
  prodFloorW: 120,
  /**
   * Part réactive de la pince « Consommation » (var), retirée en quadrature : la pince lit une
   * puissance apparente, juste à forte charge mais double près du fond (240 W lus pour 120 W réels
   * la nuit). Calée sur Linky (Hello Watt) les 05 et 10/11/2026 : soutirage 9,45 et 12,89 kWh
   * pour 9,36 et 12,76 réels, contre 11,45 et 14,72 sans correction. Même valeur que steps.py
   * (fhe_solar 0.7.0).
   */
  consoReactiveVar: 210,
  /**
   * Creux d'un seul relevé : un OFF aussitôt suivi (<= 150 s) d'un ON qui reprend au moins 60 % de
   * la baisse n'est pas un arrêt. Apparu avec le relevé à la minute (10/10/2026) : le chauffe-eau
   * a plongé 1 min à 13 h 02 (1 376 -> 947 W) puis est remonté ; ce faux « retour au niveau »
   * fermait sa session et arrêtait son compteur HA alors qu'il a chauffé jusqu'à 14 h.
   */
  dipWindowS: 150,
  dipRecoverRatio: 0.6,
  /**
   * Creux solaire : quand le soleil perce, la consommation FHE plonge d'autant que la production
   * monte (03/11/2026, 14 h 38 → 15 h 12 : conso + production restent à ~2 170 W, production de 300
   * à 1 500 W). Le chauffe-eau semble revenu à son niveau de départ alors qu'il chauffe jusqu'à
   * 16 h 29 : sa session se fermait à 37 min (0,6 kWh au lieu de 3,5) et les à-coups fabriquaient de
   * fausses sessions (PC Lenny, 0,85 kWh). Conso et production ne tombent pas sur le même relevé :
   * on regarde l'amplitude de la production autour de l'arrêt, et la reprise qui le suit.
   */
  solarDipSwingW: 500,
  solarDipSwingMin: 5,
  solarDipRecoverMin: 15,
  solarDipRecoverShare: 0.5,
  /** Plus petit échelon gardé (même seuil que l'automation HA de détection). */
  minStepW: 200,
} as const;

const ts = (iso: string) => new Date(iso).getTime();

/** Recouvrement de deux sessions, en part de la plus courte (0 si l'une est encore ouverte). */
function overlapShare(a: Session, b: Session): number {
  if (!a.end_ts || !b.end_ts) return 0;
  const o = Math.min(ts(a.end_ts), ts(b.end_ts)) - Math.max(ts(a.start_ts), ts(b.start_ts));
  const shorter = Math.min(ts(a.end_ts) - ts(a.start_ts), ts(b.end_ts) - ts(b.start_ts));
  return o > 0 && shorter > 0 ? o / shorter : 0;
}

/**
 * Retire les creux d'un relevé (voir PARAMS.dipWindowS). Le ON qui suit perd l'amplitude du creux
 * et repart du niveau d'avant celui-ci ; s'il ne reste qu'un résidu sous le seuil, il disparaît
 * aussi. Une pointe brève (ON puis OFF), elle, est un vrai appareil court (bouilloire) : gardée.
 */
export function removeDips(sorted: PowerEvent[]): PowerEvent[] {
  const out: PowerEvent[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const off = sorted[i];
    const on = sorted[i + 1];
    if (
      off.direction === "off" &&
      on?.direction === "on" &&
      (ts(on.ts) - ts(off.ts)) / 1000 <= (isFine(off.ts) ? PARAMS.fineWindowS : PARAMS.dipWindowS) &&
      on.delta_w >= PARAMS.dipRecoverRatio * -off.delta_w
    ) {
      const rest = on.delta_w + off.delta_w;
      if (rest >= minStepAt(off.ts)) {
        out.push({ ...on, delta_w: rest, power_before: off.power_before ?? on.power_before });
      }
      i++; // le ON est consommé avec le creux
      continue;
    }
    out.push(off);
  }
  return out;
}

/** Événement issu de la courbe à 7 s (voir PARAMS.fineSamplingSince). */
function isFine(iso: string): boolean {
  return PARAMS.fineSamplingSince != null && ts(iso) >= ts(PARAMS.fineSamplingSince);
}

/** Plus petit échelon gardé à cet instant (seuil de l'automation HA en vigueur). */
function minStepAt(iso: string): number {
  return isFine(iso) ? PARAMS.fineMinStepW : PARAMS.minStepW;
}

/** Écart de magnitude toléré entre un ON et son OFF. */
function pairTol(on: PowerEvent): number {
  return Math.max(PARAMS.pairRelTol * on.delta_w, isFine(on.ts) ? PARAMS.pairAbsTolFineW : PARAMS.pairAbsTolW);
}

/** Fenêtre de fusion selon le rythme de relevé en vigueur à cet instant. */
export function mergeWindowAt(iso: string): number {
  if (isFine(iso)) return PARAMS.fineWindowS;
  return ts(iso) >= ts(PARAMS.minutePollingSince) ? PARAMS.mergeWindowMinuteS : PARAMS.mergeWindowS;
}

/** Fusionne les événements de même sens très rapprochés (même échelon vu sur 2 relevés). */
export function mergeEvents(events: PowerEvent[]): PowerEvent[] {
  const sorted = removeDips([...events].sort((a, b) => ts(a.ts) - ts(b.ts) || a.id - b.id));
  const out: PowerEvent[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.direction === e.direction &&
      (ts(e.ts) - ts(last.ts)) / 1000 <= mergeWindowAt(last.ts)
    ) {
      // On garde l'id et l'instant du premier relevé (début de l'échelon), l'amplitude cumulée et le niveau final.
      out[out.length - 1] = {
        ...last,
        delta_w: last.delta_w + e.delta_w,
        power_after: e.power_after ?? last.power_after,
        production_power: e.production_power ?? last.production_power,
      };
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/** Courbe à 7 s : la production a-t-elle bougé d'au moins solarDipSwingW autour de merged[j] ? */
function solarSwingAt(merged: PowerEvent[], j: number): boolean {
  const t = ts(merged[j].ts);
  if (!isFine(merged[j].ts)) return false;
  const near = merged.filter((e) => Math.abs(ts(e.ts) - t) <= PARAMS.solarDipSwingMin * 60000 && e.production_power != null);
  const prods = near.map((e) => e.production_power!);
  return prods.length > 0 && Math.max(...prods) - Math.min(...prods) >= PARAMS.solarDipSwingW;
}

/**
 * Retour au niveau merged[j] d'un gros appareil merged[i] : si c'est un creux solaire (voir
 * PARAMS.solarDipSwingW), indice de l'événement où la puissance est revenue, sinon null. Tant que
 * la fenêtre de reprise court, le doute profite à l'appareil : dernier indice, il tourne toujours.
 */
function solarDipEnd(merged: PowerEvent[], i: number, j: number, nowMs: number): number | null {
  const on = merged[i];
  const t = ts(merged[j].ts);
  if (on.power_before == null || !solarSwingAt(merged, j)) return null;
  const floor = on.power_before + PARAMS.solarDipRecoverShare * on.delta_w;
  const limit = t + PARAMS.solarDipRecoverMin * 60000;
  for (let k = j + 1; k < merged.length && ts(merged[k].ts) <= limit; k++) {
    if (merged[k].direction === "on" && (merged[k].power_after ?? 0) >= floor) return k;
  }
  return nowMs < limit ? merged.length - 1 : null;
}

/**
 * Apparie chaque ON avec le prochain OFF de magnitude la plus proche (pas le premier trouvé),
 * dans une fenêtre de 4 h. Retourne les sessions et le nombre d'événements non appariés.
 *
 * `nowMs` : instant du calcul. Un gros appareil (arrêt par retour au niveau) dont le retour
 * n'est pas encore arrivé reste en marche tant que sa fenêtre de 4 h n'est pas écoulée, au lieu
 * de se rabattre sur un OFF de magnitude voisine. Cas réel du 09/10/2026 : chauffe-eau démarré à
 * 11 h 24, apparié vers 12 h 30 à l'arrêt (12 h 24) de la 2e chauffe du lave-vaisselle, de même
 * puissance ; son compteur HA en direct s'est arrêté là alors qu'il a chauffé jusqu'à 14 h 15.
 * Par défaut (Infinity), tout l'historique est considéré comme terminé.
 */
export function pairSessions(merged: PowerEvent[], nowMs = Infinity): { sessions: Session[]; unpaired: number } {
  const used = new Set<number>();
  // Amplitude encore disponible d'un OFF déjà attribué : deux appareils coupés ensemble ne font
  // qu'une baisse. Cas réel du 23/10/2026 : les deux résistances du four (1 789 W à 11 h 52,
  // 1 856 W à 11 h 55) coupent ensemble (−3 450 W) ; la 2e allait chercher la baisse suivante et
  // tout le cycle de thermostat se décalait d'un cran (sessions chevauchées, 1,4 kWh compté en trop).
  const remaining = new Map<number, number>();
  const left = (j: number) => remaining.get(j) ?? -merged[j].delta_w;
  // device_sessions.off_event_id est unique en base : une 2e session fermée par le même OFF prend
  // son propre ON comme référence de fin (end_ts reste la vraie heure de fin).
  const offTaken = new Set<number>();
  // Courbe à 7 s : un OFF qui suit immédiatement un ON de même amplitude (impulsion) lui est
  // réservé. Cas réel du 31/10/2026 : un appareil de 295 W démarré à 12 h 23 a pris l'arrêt
  // (−388 W, 15 h 56 m 55 s) d'une impulsion de 7 s ; l'impulsion est allée chercher un arrêt
  // de −604 W à 17 h 47, et cette fausse session de 110 min a compté 0,9 kWh au thermodynamique.
  const reservedBy = new Map<number, number>();
  for (let i = 0; i + 1 < merged.length; i++) {
    const on = merged[i];
    const off = merged[i + 1];
    if (
      on.direction === "on" &&
      off.direction === "off" &&
      isFine(on.ts) &&
      (ts(off.ts) - ts(on.ts)) / 1000 <= PARAMS.pulseMaxS &&
      Math.abs(-off.delta_w - on.delta_w) <= pairTol(on)
    ) {
      reservedBy.set(i + 1, i);
    }
  }
  const takenElsewhere = (j: number, i: number) => reservedBy.has(j) && reservedBy.get(j) !== i;
  const sessions: Session[] = [];
  const sessionEvents: [number, number][] = [];
  const openBig: number[] = [];
  // À-coups d'un creux solaire : ni démarrages ni arrêts, personne ne les prend.
  const solarNoise = new Set<number>();
  for (let i = 0; i < merged.length; i++) {
    const on = merged[i];
    if (on.direction !== "on" || on.delta_w <= 0 || solarNoise.has(i)) continue;
    let best: { err: number; j: number } | null = null;
    const byLevel = on.delta_w >= PARAMS.levelPairMinW && on.power_before != null;
    if (byLevel) {
      // Premier OFF qui ramène la puissance au niveau d'avant le démarrage.
      // Plancher à 0 : les prises déduites peuvent rendre le niveau négatif. Le 04/11/2026 (−308 W),
      // le retour à 243 W à 16 h 35 n'a pas été reconnu : 2 min d'appareil sont devenues 100 min de
      // chauffe-eau, 3,5 kWh comptés à 18 h.
      const ceiling = Math.max(on.power_before!, 0) + Math.max(PARAMS.levelRelTol * on.delta_w, PARAMS.levelAbsTolW);
      let dipFrom = -1;
      let dipTo = -1;
      for (let j = i + 1; j < merged.length; j++) {
        const off = merged[j];
        if ((ts(off.ts) - ts(on.ts)) / 1000 > PARAMS.pairWindowS) break;
        if (off.direction !== "off") continue;
        const atLevel = off.power_after != null && off.power_after <= ceiling;
        const back = atLevel ? solarDipEnd(merged, i, j, nowMs) : null;
        if (back != null) {
          if (dipFrom < 0) dipFrom = j;
          dipTo = back;
          j = back;
          continue;
        }
        if (used.has(j) || takenElsewhere(j, i)) continue;
        // OFF partagé : il doit lui rester de quoi couper cet appareil aussi.
        if (remaining.has(j) && left(j) < (1 - PARAMS.levelRelTol) * on.delta_w) continue;
        if (atLevel) {
          best = { err: 0, j };
          break;
        }
      }
      for (let k = dipFrom; dipFrom >= 0 && k <= dipTo; k++) {
        solarNoise.add(k);
        used.add(k);
      }
    }
    // Retour au niveau pas encore arrivé, fenêtre encore ouverte : l'appareil tourne toujours.
    if (!best && byLevel && nowMs - ts(on.ts) < PARAMS.pairWindowS * 1000) {
      openBig.push(ts(on.ts));
      continue;
    }
    // L'événement suivant est un OFF de même amplitude : rien d'autre n'a bougé, c'est le sien.
    // Cas réel des matins du 19 au 21/10/2026 : thermostat du sèche-serviettes en impulsions
    // d'1 min (~350 W) toutes les 5 min ; « la plus proche en magnitude » allait chercher un OFF
    // des heures plus tard et fabriquait des sessions de 3 h.
    const next = merged[i + 1];
    if (
      !best &&
      PARAMS.pairNextOff &&
      next &&
      next.direction === "off" &&
      !used.has(i + 1) &&
      (ts(next.ts) - ts(on.ts)) / 1000 <= PARAMS.pairWindowS &&
      Math.abs(left(i + 1) - on.delta_w) <= pairTol(on)
    ) {
      best = { err: Math.abs(left(i + 1) - on.delta_w), j: i + 1 };
    }
    if (!best) {
      for (let j = i + 1; j < merged.length; j++) {
        const off = merged[j];
        if ((ts(off.ts) - ts(on.ts)) / 1000 > PARAMS.pairWindowS) break;
        if (off.direction !== "off" || used.has(j) || takenElsewhere(j, i)) continue;
        const err = Math.abs(left(j) - on.delta_w);
        if (err <= pairTol(on) && (!best || err < best.err)) {
          best = { err, j };
        }
      }
    }
    if (!best) continue;
    const off = merged[best.j];
    const offMag = left(best.j);
    // Par niveau, l'appareil ne consomme que son propre saut ; sinon le OFF est épuisé.
    // Sauf si l'écart vient du solaire : le 05/11/2026, chauffe-eau parti à +1 455 W avec 661 W de
    // production, coupé à −1 761 W avec 206 W ; les 306 W restants ont fermé une fausse session de
    // 297 W, comptée 0,55 kWh au PC.
    const prodGap = isFine(off.ts) ? Math.abs((on.production_power ?? 0) - (off.production_power ?? 0)) : 0;
    const rest = byLevel && best.err === 0 && offMag - on.delta_w > prodGap ? offMag - on.delta_w : 0;
    if (rest >= minStepAt(off.ts)) remaining.set(best.j, rest);
    else used.add(best.j);
    const durationMin = (ts(off.ts) - ts(on.ts)) / 60000;
    let powerW = byLevel && best.err === 0 ? on.delta_w : (on.delta_w + offMag) / 2;
    if (byLevel && best.err === 0 && durationMin >= PARAMS.revealMinMinutes) {
      const revealed = revealedPowerW(merged, i, best.j);
      if (revealed != null) powerW = revealed;
    }
    // Un simple seuil de production (ex. > 50 W) comptait comme « solaire » un four de 1,7 kW
    // lancé au crépuscule avec 120 W de production : on mesure plutôt la part couverte.
    const coverage = (e: PowerEvent) => Math.min(Math.max(e.production_power ?? 0, 0) / Math.max(powerW, 1), 1);
    sessionEvents.push([i, best.j]);
    sessions.push({
      on_event_id: on.id,
      off_event_id: offTaken.has(off.id) ? on.id : (offTaken.add(off.id), off.id),
      start_ts: on.ts,
      end_ts: off.ts,
      // Arrêt par paliers : seul le démarrage reflète la puissance nominale.
      power_w: Math.round(powerW),
      duration_min: Math.round(durationMin * 10) / 10,
      pct_solar: Math.round(((coverage(on) + coverage(off)) / 2) * 100) / 100,
    });
  }
  // Sous un gros appareil qui tourne, le passage des nuages fait monter et descendre la courbe par
  // à-coups : un petit « appareil » né ou mort dans ces mouvements de production n'existe pas.
  // Cas réel du 05/11/2026 : 14 h 40 → 15 h 49 à 304 W pendant la chauffe, compté au PC.
  const hosts: [number, number][] = [
    ...sessions.filter((s) => s.power_w >= PARAMS.levelPairMinW && s.duration_min >= PARAMS.revealMinMinutes).map((s): [number, number] => [ts(s.start_ts), ts(s.end_ts)]),
    ...openBig.map((t): [number, number] => [t, nowMs]),
  ];
  const kept = sessions.filter((s, n) => {
    if (s.power_w >= PARAMS.levelPairMinW) return true;
    const [from, to] = [ts(s.start_ts), ts(s.end_ts)];
    if (!hosts.some(([a, b]) => a < from && to <= b)) return true;
    const [i, j] = sessionEvents[n];
    return !(solarSwingAt(merged, i) || solarSwingAt(merged, j));
  });
  const onCount = merged.filter((e) => e.direction === "on").length;
  const offCount = merged.filter((e) => e.direction === "off").length;
  const unpaired = onCount - kept.length + (offCount - kept.length);
  return { sessions: kept, unpaired };
}

/**
 * Puissance propre d'un gros appareil dont le démarrage (merged[i]) a coïncidé avec celui d'un
 * appareil bref : le premier arrêt dans les `revealWindowMin` minutes qui laisse un surplus entre
 * `revealMinRatio` et `revealMaxRatio` du saut de départ révèle l'appareil seul. null sinon.
 */
export function revealedPowerW(merged: PowerEvent[], i: number, j: number): number | null {
  const on = merged[i];
  if (on.power_before == null) return null;
  for (let k = i + 1; k < j; k++) {
    const e = merged[k];
    if ((ts(e.ts) - ts(on.ts)) / 60000 > PARAMS.revealWindowMin) break;
    if (e.direction !== "off" || e.power_after == null) continue;
    // Baisse due au soleil, pas à un appareil qui s'arrête : le 05/11/2026 à 14 h 02, elle a
    // « révélé » 1 016 W et sorti le chauffe-eau de sa carte.
    if (solarSwingAt(merged, k) || (isFine(e.ts) && Math.abs((e.production_power ?? 0) - (on.production_power ?? 0)) >= PARAMS.solarDipSwingW)) continue;
    const excess = e.power_after - on.power_before;
    if (excess >= PARAMS.revealMinRatio * on.delta_w && excess <= PARAMS.revealMaxRatio * on.delta_w) return excess;
  }
  return null;
}

type Feature = [number, number];

/** (ln puissance, ln durée) mises à l'échelle : une distance de 1 = tolérance de 1 « unité ». */
export function feature(powerW: number, durationMin: number): Feature {
  return [
    Math.log(Math.max(powerW, 1)) / PARAMS.powerLogScale,
    Math.log(Math.max(durationMin, 0.5)) / PARAMS.durationLogScale,
  ];
}

const dist = (a: Feature, b: Feature) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** DBSCAN minimal (O(n²), n = quelques centaines de sessions). Retourne l'indice de cluster par point, -1 = bruit. */
export function dbscan(points: Feature[], eps: number, minPts: number): number[] {
  const labels = new Array<number>(points.length).fill(-2); // -2 non visité, -1 bruit
  const neighbors = (i: number) => points.flatMap((p, j) => (dist(points[i], p) <= eps ? [j] : []));
  let cluster = 0;
  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== -2) continue;
    const seeds = neighbors(i);
    if (seeds.length < minPts) {
      labels[i] = -1;
      continue;
    }
    labels[i] = cluster;
    const queue = [...seeds];
    while (queue.length) {
      const q = queue.pop()!;
      if (labels[q] === -1) labels[q] = cluster;
      if (labels[q] !== -2) continue;
      labels[q] = cluster;
      const more = neighbors(q);
      if (more.length >= minPts) queue.push(...more);
    }
    cluster++;
  }
  return labels;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Minute du jour (0..1439), heure de Paris. */
export function localMinute(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: PARAMS.timeZone }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/**
 * Heure de démarrage habituelle d'un appareil programmé (minute du jour), ou null s'il n'est pas
 * régulier : au moins RUNNING.usualMinSessions sessions et un écart médian <= usualMaxSpreadMin.
 * Seules les RUNNING.usualRecentSessions dernières sessions comptent : quand le programme change
 * (chauffe-eau passé de 11 h 30 à 14 h le 18/10/2026), la nouvelle heure est reprise en ~5 jours.
 * Ne sert qu'au compteur en direct, jamais à reconnaître l'appareil.
 */
export function usualStartMinute(startIsos: string[]): number | null {
  if (startIsos.length < RUNNING.usualMinSessions) return null;
  const recent = [...startIsos].sort().slice(-RUNNING.usualRecentSessions);
  const mins = recent.map(localMinute);
  const m = median(mins);
  if (median(mins.map((x) => Math.abs(x - m))) > RUNNING.usualMaxSpreadMin) return null;
  // Pendant un changement de programme, la médiane peut encore pointer l'ancienne heure : les
  // 3 dernières chauffes doivent toutes y être. Cas réel du 23/10/2026 : programme passé de 11 h 30
  // à 14 h 45 ; le four lancé à 11 h 52 a été compté en direct comme chauffe-eau.
  return mins.slice(-3).every((x) => Math.abs(x - m) <= RUNNING.usualMaxSpreadMin) ? m : null;
}

function localHour(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: PARAMS.timeZone }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
}

/**
 * Classe les sessions :
 *  1. dans un cluster NOMMÉ existant si elles tombent dans son rayon (jamais recréé ni renommé) ;
 *  2. les autres passent dans DBSCAN, qui ne crée/met à jour que des clusters NON nommés.
 * Les clusters non nommés gardent leur id d'un run à l'autre (appariement au plus proche centroïde).
 */
/** Changement d'état d'un appareil suivi par HA (ex. vidéoprojecteur via Android TV Remote). */
export type DeviceState = { device: string; ts: string; state: string };

/**
 * Prises mesurées : HA envoie dans device_states `device = "prise:<nom>"`, `state = <W>` à chaque
 * variation d'au moins 60 W (lave-vaisselle, coin cinéma). Leur puissance est retirée des échelons
 * de la maison avant la recherche d'appareils : un appareil déjà mesuré ne doit ni former de
 * cartes ni brouiller les autres (31/10/2026 : chauffes du lave-vaisselle appariées avec d'autres
 * appareils, projecteur confondu avec le thermodynamique).
 */
export const PLUG_PREFIX = "prise:";
/** Une prise et le compteur FHE datent le même changement à ±30 s près (relevé 10 s / courbe 7 s). */
export const PLUG_WINDOW_S = 40;

export function subtractPlugs(merged: PowerEvent[], states: DeviceState[]): PowerEvent[] {
  const series = new Map<string, [number, number][]>();
  for (const s of states) {
    if (!s.device.startsWith(PLUG_PREFIX)) continue;
    const w = Number(s.state);
    if (!Number.isFinite(w)) continue;
    const list = series.get(s.device) ?? [];
    list.push([ts(s.ts), w]);
    series.set(s.device, list);
  }
  if (series.size === 0) return merged;
  for (const list of series.values()) list.sort((a, b) => a[0] - b[0]);
  // Puissance d'une prise à l'instant t (dernière valeur connue) ; null avant son premier relevé.
  const levelAt = (list: [number, number][], t: number): number | null => {
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found < 0 ? null : list[found][1];
  };
  const out: PowerEvent[] = [];
  for (const e of merged) {
    const t = ts(e.ts);
    let before = 0;
    let after = 0;
    for (const list of series.values()) {
      const b = levelAt(list, t - PLUG_WINDOW_S * 1000);
      const a = levelAt(list, t + PLUG_WINDOW_S * 1000);
      if (b == null || a == null) continue;
      before += b;
      after += a;
    }
    // Les niveaux sont toujours corrigés (même sans variation de prise) : l'appariement par retour
    // au niveau compare des niveaux pris à des heures différentes, prise allumée ou non.
    const delta = e.delta_w - (after - before);
    if (Math.abs(delta) < minStepAt(e.ts)) continue; // échelon entièrement expliqué par une prise
    out.push({
      ...e,
      delta_w: delta,
      direction: delta > 0 ? "on" : "off",
      power_before: e.power_before != null ? e.power_before - before : e.power_before,
      power_after: e.power_after != null ? e.power_after - after : e.power_after,
    });
  }
  return out;
}

/**
 * Contexte d'un appareil dont HA connaît l'état : ses sessions ne peuvent rejoindre les cartes
 * dont le nom commence par `labelPrefix` que si l'appareil était allumé pendant au moins
 * `minOnShare` de la session. Cas réel : vidéoprojecteur (~140 W + ~400-650 W en lecture) et
 * chauffe-eau thermodynamique (~450 W) donnent des sessions de même puissance ; l'état du
 * projecteur dans HA les départage. Avant `since` (début du suivi), rien ne change.
 */
export type DeviceContext = {
  labelPrefix: string;
  since: string;
  on: [number, number][];
  minOnShare: number;
  /**
   * Appareil mesuré par une prise (ex. chauffes du lave-vaisselle) : une session d'au moins
   * `minPowerW` qui tombe dans ses périodes de chauffe ne peut aller QUE dans une carte de ce nom.
   * Sans carte de ce nom, elle reste orpheline et formera une carte à nommer.
   */
  exclusiveMinPowerW?: number;
};

export const CONTEXTS: { device: string; labelPrefix: string; minOnShare: number; exclusiveMinPowerW?: number }[] = [
  { device: "video_proj", labelPrefix: "Vidéo proj", minOnShare: 0.5 },
  // Prises Koogeek : HA envoie « on » au-delà de 1 000 W (chauffe de l'eau), « off » sous 500 W.
  // Cas réel du 23/10/2026 : 4 chauffes de 2,2 kW (8 à 18 min) que le NILM rangeait dans le four.
  { device: "lave_vaisselle", labelPrefix: "Lave-vaisselle", minOnShare: 0.6, exclusiveMinPowerW: 800 },
  { device: "lave_linge", labelPrefix: "Lave-linge", minOnShare: 0.6, exclusiveMinPowerW: 800 },
];

/** Périodes « allumé » à partir des changements d'état (un état encore « on » court jusqu'à nowMs). */
export function deviceContexts(states: DeviceState[], nowMs = Date.now()): DeviceContext[] {
  return CONTEXTS.flatMap((cfg) => {
    const ss = states.filter((s) => s.device === cfg.device).sort((a, b) => ts(a.ts) - ts(b.ts));
    if (ss.length === 0) return [];
    const on: [number, number][] = [];
    let start: number | null = null;
    for (const s of ss) {
      if (s.state === "on" && start == null) start = ts(s.ts);
      else if (s.state !== "on" && start != null) {
        on.push([start, ts(s.ts)]);
        start = null;
      }
    }
    if (start != null) on.push([start, nowMs]);
    return [
      { labelPrefix: cfg.labelPrefix, since: ss[0].ts, on, minOnShare: cfg.minOnShare, exclusiveMinPowerW: cfg.exclusiveMinPowerW },
    ];
  });
}

/** Part (0..1) de la session pendant laquelle l'appareil était allumé. */
export function onShare(s: Session, ctx: DeviceContext): number {
  const a = ts(s.start_ts);
  const b = Math.max(ts(s.end_ts), a + 60000);
  const covered = ctx.on.reduce((acc, [x, y]) => acc + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  return covered / (b - a);
}

/**
 * Fer à repasser : son thermostat fait des impulsions de ~2 kW (6 à 90 s) toutes les 1 à 3 min,
 * indiscernables une à une d'une impulsion de four ou d'une bouilloire. C'est la série qui le
 * trahit : beaucoup d'impulsions rapprochées SANS préchauffe longue juste avant (le four commence
 * toujours par 10 min et plus à pleine puissance). Cas réel du 01/11/2026, 17 h 54 → 18 h 39 :
 * 20 impulsions à 2,14 kW, rangées dans « Four · impulsions 2 kW » (17) et « Bouilloire » (3).
 */
export const PULSE_TRAIN = {
  labelPrefix: "Fer à repasser",
  minPowerW: 1600,
  maxPowerW: 2700,
  maxPulseMin: 2,
  /** Écart maximal entre la fin d'une impulsion et le début de la suivante. */
  maxGapMin: 5,
  minPulses: 6,
  /**
   * Le four régule comme une horloge : une impulsion toutes les 70 s (31/10/2026, 4 séries sans
   * préchauffe visible, 90 % des écarts entre 63 et 77 s). Le fer revient au gré du repassage,
   * toutes les 35 à 240 s (01/11/2026 : 3 écarts sur 19 et 0 sur 8 dans cette plage). Une série dont
   * au moins la moitié des écarts (début à début) tombe dans la plage du four n'est pas un fer.
   */
  ovenPeriodS: [60, 80] as [number, number],
  maxOvenPeriodShare: 0.5,
  /** Une chauffe longue de même gamme qui finit moins de 30 min avant la série = un four. */
  preheatMinMin: 8,
  preheatLookbackMin: 30,
} as const;

/** Indices des sessions qui forment une série d'impulsions de fer à repasser. */
export function pulseTrainSessions(sessions: Session[]): Set<number> {
  const P = PULSE_TRAIN;
  const inRange = (s: Session) => s.power_w >= P.minPowerW && s.power_w <= P.maxPowerW;
  const pulses = sessions
    .flatMap((s, i) => (inRange(s) && s.duration_min <= P.maxPulseMin && s.end_ts ? [i] : []))
    .sort((a, b) => ts(sessions[a].start_ts) - ts(sessions[b].start_ts));
  const preheatEnds = sessions.filter((s) => inRange(s) && s.duration_min >= P.preheatMinMin && s.end_ts).map((s) => ts(s.end_ts));
  const out = new Set<number>();
  const flush = (train: number[]) => {
    if (train.length < P.minPulses) return;
    const a = ts(sessions[train[0]].start_ts);
    const b = ts(sessions[train.at(-1)!].end_ts);
    if (preheatEnds.some((e) => e >= a - P.preheatLookbackMin * 60000 && e <= b)) return;
    const periods = train.slice(1).map((i, k) => ts(sessions[i].start_ts) - ts(sessions[train[k]].start_ts));
    const [lo, hi] = P.ovenPeriodS;
    const ovenLike = periods.filter((d) => d >= lo * 1000 && d <= hi * 1000).length;
    if (ovenLike >= P.maxOvenPeriodShare * periods.length) return;
    train.forEach((i) => out.add(i));
  };
  let train: number[] = [];
  for (const i of pulses) {
    const prev = train.at(-1);
    if (prev != null && ts(sessions[i].start_ts) - ts(sessions[prev].end_ts) > P.maxGapMin * 60000) {
      flush(train);
      train = [];
    }
    train.push(i);
  }
  flush(train);
  return out;
}

/**
 * Lave-linge : ses chauffes de ~2 kW ressemblent à celles du four et son essorage à un micro-onde.
 * C'est l'enchaînement qui le trahit : des chauffes, puis, une demi-heure à deux heures plus tard,
 * une série d'à-coups de moteur. Cas réel du 04/11/2026 : chauffes à 11 h 30, 11 h 44 et 12 h 38
 * (cartes du four), essorage de 13 h 14 à 13 h 33, 8 à-coups de 500 à 1 100 W (carte du micro-onde).
 */
export const WASHER_CYCLE = {
  labelPrefix: "Lave-linge · chauffe",
  heatPowerW: [1650, 2700] as [number, number],
  heatMinMin: 4,
  heatMaxMin: 45,
  spinPowerW: [450, 1300] as [number, number],
  spinMaxMin: 1.5,
  spinMaxGapMin: 6,
  spinMinPulses: 5,
  /** Fin de la dernière chauffe → début de l'essorage. */
  leadMin: [20, 120] as [number, number],
  /** Deux chauffes d'un même cycle sont à moins de ça l'une de l'autre. */
  maxHeatGapMin: 75,
  /**
   * Programme doux (30 °C) : pas de longue chauffe mais 3 chauffes brèves qui raccourcissent,
   * toujours au même rythme. 01/11/2026 12:22, 12:30, 12:45 ; 07/11 11:03, 11:14, 11:29 ; 11/11
   * 10:19, 10:29, 10:44 (confirmé par l'utilisateur : 3,0 puis 2,3 puis 1,3 min à 1,7–1,8 kW,
   * rangées en « Bouilloire »). Sur 11 jours de courbe à 7 s, ces trois séries sont les seules
   * suites de 3 chauffes de 1 à 4 min séparées de 5 à 25 min. Le tambour frémit trop peu sur ce
   * programme (~25 W entre relevés, comme la pompe du lave-vaisselle) pour WASHER_DRUM.
   */
  shortHeatPowerW: [1600, 2150] as [number, number],
  shortHeatMin: [1, 4] as [number, number],
  shortHeatGapMin: [5, 25] as [number, number],
  shortHeatCount: 3,
} as const;

/**
 * Lave-linge reconnu à son tambour sur la courbe à 7 s : pendant tout un cycle, la puissance de
 * la maison bouge de ~100 W d'un relevé au suivant (brassage, inversions de sens), ce qu'aucun
 * autre appareil de la maison ne fait aussi longtemps. Cycle du 04/11/2026 (11 h 26 → 13 h 33) :
 * 77 à 93 % des écarts entre relevés voisins dans 25–400 W, médiane 80–135 W, contre 0–10 % au
 * repos et 20–58 % pendant un lave-vaisselle. Balayage du 01 au 10/11/2026 : ce cycle d'un bloc
 * (11 h 25 → 13 h 25) et aucune autre période, jours de soleil compris. Validé sur ce seul cycle.
 */
export const WASHER_DRUM = {
  device: "lave_linge",
  blockMin: 5,
  /** Tranche « agitée » : assez de relevés, part d'écarts de 25 à 400 W, écart médian. */
  minPairs: 20,
  deltaW: [25, 400] as [number, number],
  minShare: 0.7,
  minMedianW: 50,
  /** Tranches calmes tolérées dans un cycle (trempage, vidange). */
  maxGapBlocks: 3,
  /** En dessous, ce n'est pas un cycle (une tranche agitée isolée arrive : 04/11, 16 h 10). */
  minHotBlocks: 6,
  /** Le brassage ne démarre qu'après le remplissage : le cycle commence une tranche plus tôt. */
  leadBlocks: 1,
} as const;

export type WasherWindow = { start: number; end: number; hotBlocks: number };

/**
 * Cycles de lave-linge dans une courbe [ms, soutirage W, production W] (triée). `end` est la fin
 * de la dernière tranche agitée : un cycle est clos quand la courbe dépasse cette fin de plus de
 * `maxGapBlocks` tranches.
 */
export function washerWindows(points: [number, number, number | null][]): WasherWindow[] {
  const P = WASHER_DRUM;
  const blockMs = P.blockMin * 60000;
  const blocks = new Map<number, number[]>();
  for (let i = 1; i < points.length; i++) {
    const [t0, c0, p0] = points[i - 1];
    const [t1, c1, p1] = points[i];
    if (t1 - t0 > 15000) continue;
    const d = Math.abs(realConsumptionW(c1) + effectiveProductionW(p1 ?? 0) - realConsumptionW(c0) - effectiveProductionW(p0 ?? 0));
    const k = Math.floor(t1 / blockMs);
    const list = blocks.get(k);
    if (list) list.push(d);
    else blocks.set(k, [d]);
  }
  const hot = [...blocks]
    .filter(([, d]) => d.length >= P.minPairs && d.filter((x) => x >= P.deltaW[0] && x <= P.deltaW[1]).length / d.length >= P.minShare && median(d) >= P.minMedianW)
    .map(([k]) => k)
    .sort((a, b) => a - b);
  const out: WasherWindow[] = [];
  let first = -1, prev = -1, count = 0;
  const flush = () => {
    if (count >= P.minHotBlocks) out.push({ start: (first - P.leadBlocks) * blockMs, end: (prev + 1) * blockMs, hotBlocks: count });
  };
  for (const k of hot) {
    if (first >= 0 && k - prev - 1 > P.maxGapBlocks) {
      flush();
      first = -1;
    }
    if (first < 0) { first = k; count = 0; }
    prev = k;
    count++;
  }
  if (first >= 0) flush();
  return out;
}

/**
 * États « on » / « off » du lave-linge à ajouter à device_states pour ces cycles, sans doublon
 * avec ceux déjà enregistrés (un « on » à ±15 min du début). Le « off » n'est émis qu'une fois le
 * cycle clos ; d'ici là l'état reste « on », ce que deviceContexts prolonge jusqu'à maintenant.
 */
export function washerStates(windows: WasherWindow[], existing: DeviceState[], lastPointMs: number): DeviceState[] {
  const P = WASHER_DRUM;
  const mine = existing.filter((s) => s.device === P.device);
  const near = (state: string, t: number) => mine.some((s) => s.state === state && Math.abs(ts(s.ts) - t) <= 15 * 60000);
  const out: DeviceState[] = [];
  for (const w of windows) {
    if (!near("on", w.start)) out.push({ device: P.device, ts: new Date(w.start).toISOString(), state: "on" });
    const closed = lastPointMs - w.end > P.maxGapBlocks * P.blockMin * 60000;
    if (closed && !mine.some((s) => s.state === "off" && ts(s.ts) >= w.end - 60000 && ts(s.ts) <= w.end + 15 * 60000)) {
      out.push({ device: P.device, ts: new Date(w.end).toISOString(), state: "off" });
    }
  }
  return out;
}

/** Sessions d'un cycle de lave-linge : chauffes et à-coups d'essorage. */
export function washerCycleSessions(sessions: Session[]): { heats: Set<number>; spins: Set<number> } {
  const P = WASHER_CYCLE;
  const heats = new Set<number>();
  const spins = new Set<number>();
  const inside = (w: number, [lo, hi]: [number, number]) => w >= lo && w <= hi;
  const byStart = (a: number, b: number) => ts(sessions[a].start_ts) - ts(sessions[b].start_ts);
  // À-coups d'essorage invisibles avant la courbe à 7 s.
  const all = sessions.flatMap((s, i) => (s.end_ts && isFine(s.start_ts) ? [i] : []));
  const heatIdx = all.filter((i) => inside(sessions[i].power_w, P.heatPowerW) && sessions[i].duration_min >= P.heatMinMin && sessions[i].duration_min <= P.heatMaxMin).sort(byStart);
  const pulses = all.filter((i) => inside(sessions[i].power_w, P.spinPowerW) && sessions[i].duration_min <= P.spinMaxMin).sort(byStart);
  const flush = (train: number[]) => {
    if (train.length < P.spinMinPulses) return;
    const a = ts(sessions[train[0]].start_ts);
    const before = heatIdx.filter((i) => ts(sessions[i].end_ts) <= a);
    const last = before.at(-1);
    if (last == null) return;
    const lead = (a - ts(sessions[last].end_ts)) / 60000;
    if (lead < P.leadMin[0] || lead > P.leadMin[1]) return;
    train.forEach((i) => spins.add(i));
    let k = before.length - 1;
    heats.add(before[k]);
    while (k > 0 && ts(sessions[before[k]].start_ts) - ts(sessions[before[k - 1]].end_ts) <= P.maxHeatGapMin * 60000) heats.add(before[--k]);
  };
  let train: number[] = [];
  for (const i of pulses) {
    const prev = train.at(-1);
    if (prev != null && ts(sessions[i].start_ts) - ts(sessions[prev].end_ts) > P.spinMaxGapMin * 60000) {
      flush(train);
      train = [];
    }
    train.push(i);
  }
  flush(train);
  // Programme doux : série de chauffes brèves (voir WASHER_CYCLE.shortHeat*).
  const short = all
    .filter((i) => inside(sessions[i].power_w, P.shortHeatPowerW) && inside(sessions[i].duration_min, P.shortHeatMin))
    .sort(byStart);
  let serie: number[] = [];
  const close = () => {
    if (serie.length >= P.shortHeatCount) serie.forEach((i) => heats.add(i));
    serie = [];
  };
  for (const i of short) {
    const prev = serie.at(-1);
    if (prev != null && !inside((ts(sessions[i].start_ts) - ts(sessions[prev].end_ts)) / 60000, P.shortHeatGapMin)) close();
    serie.push(i);
  }
  close();
  return { heats, spins };
}

/**
 * Sèche-serviettes de la salle de bain sur son programme du matin (confirmé par l'utilisateur le
 * 11/11/2026) : un bloc de 350 à 450 W de 40 à 60 min qui démarre entre 6 h 00 et 6 h 30
 * (04, 06, 09, 10/11/2026). Sa signature est celle d'autres appareils en journée (compresseur du
 * thermodynamique à midi, dans la même carte) : seule l'heure du programme le distingue. Exception
 * assumée au principe « l'heure n'est jamais une caractéristique » : c'est une règle nommée, pas
 * le regroupement. La carte de ce nom ne prend rien d'autre.
 */
export const MORNING_TOWEL = {
  labelPrefix: "Sèche-serviettes SdB · programme du matin",
  startMinute: [5 * 60 + 30, 6 * 60 + 45] as [number, number],
  powerW: [250, 600] as [number, number],
  durationMin: [15, 90] as [number, number],
} as const;

export function isMorningTowel(s: Session): boolean {
  const P = MORNING_TOWEL;
  const m = localMinute(s.start_ts);
  return m >= P.startMinute[0] && m <= P.startMinute[1] && s.power_w >= P.powerW[0] && s.power_w <= P.powerW[1] && s.duration_min >= P.durationMin[0] && s.duration_min <= P.durationMin[1];
}

/** Vrai si la session ne peut pas rejoindre ce cluster nommé (appareil éteint pendant la session). */
function forbidden(s: Session, c: ExistingCluster, contexts: DeviceContext[]): boolean {
  const label = c.label ?? "";
  // Le fer ne prend que des séries d'impulsions (voir clusterSessions), jamais une impulsion isolée.
  if (label.startsWith(PULSE_TRAIN.labelPrefix)) return true;
  // Idem pour le programme du matin du sèche-serviettes : attribué par sa règle horaire seulement.
  if (label.startsWith(MORNING_TOWEL.labelPrefix)) return true;
  return contexts.some((ctx) => {
    if (s.end_ts < ctx.since) return false; // session finie avant le début du suivi
    const share = onShare(s, ctx);
    const own = label.startsWith(ctx.labelPrefix);
    // Carte de l'appareil, mais l'appareil était éteint pendant la session.
    if (own && share < ctx.minOnShare) return true;
    // Session expliquée par un appareil mesuré : aucune autre carte ne peut la prendre.
    return !own && ctx.exclusiveMinPowerW != null && s.power_w >= ctx.exclusiveMinPowerW && share >= ctx.minOnShare;
  });
}

export function clusterSessions(sessions: Session[], existing: ExistingCluster[], contexts: DeviceContext[] = []): Omit<ClusteringResult, "stats"> {
  const named = existing.filter((c) => c.label && c.label.trim() !== "");
  const unnamed = existing.filter((c) => !c.label || c.label.trim() === "");

  const assignment = new Array<string | null>(sessions.length).fill(null);
  const orphans: number[] = [];
  const centroidOf = (c: ExistingCluster): Feature => [
    Math.log(Math.max(c.centroid_power_w, 1)) / PARAMS.powerLogScale,
    c.centroid_log_duration / PARAMS.durationLogScale,
  ];

  // Séries d'impulsions : toutes à la carte du fer, quelle que soit la durée de chaque impulsion
  // (6 à 90 s, trop étalé pour le rayon d'attraction) ; sans cette carte, une carte à part, à nommer.
  const trains = pulseTrainSessions(sessions);
  const iron = named.find((c) => c.label!.startsWith(PULSE_TRAIN.labelPrefix));
  const trainOrphans: number[] = [];
  // Cycle de lave-linge : chauffes à sa carte ; l'essorage ne va à aucune carte nommée (ses à-coups
  // déplaceraient le centroïde de celle des chauffes et n'ont rien à faire au micro-onde).
  const washer = washerCycleSessions(sessions);
  const washerCard = named.find((c) => c.label!.startsWith(WASHER_CYCLE.labelPrefix));
  const towelCard = named.find((c) => c.label!.startsWith(MORNING_TOWEL.labelPrefix));
  sessions.forEach((s, i) => {
    if (towelCard && isMorningTowel(s)) {
      assignment[i] = `id:${towelCard.id}`;
      return;
    }
    if (trains.has(i)) {
      if (iron) assignment[i] = `id:${iron.id}`;
      else trainOrphans.push(i);
      return;
    }
    if (washer.spins.has(i)) {
      orphans.push(i);
      return;
    }
    if (washerCard && washer.heats.has(i)) {
      assignment[i] = `id:${washerCard.id}`;
      return;
    }
    const f = feature(s.power_w, s.duration_min);
    let best: { d: number; c: ExistingCluster } | null = null;
    for (const c of named) {
      if (forbidden(s, c, contexts)) continue;
      const d = dist(f, centroidOf(c));
      if (d <= PARAMS.assignRadius && (!best || d < best.d)) best = { d, c };
    }
    if (best) assignment[i] = `id:${best.c.id}`;
    else orphans.push(i);
  });

  // Un appareil ne tourne pas deux fois en même temps : deux sessions d'une même carte qui se
  // recouvrent largement viennent d'un appariement croisé (cas réel : thermodynamique compté deux
  // fois le 21/10/2026, 15h20→17h08 et 15h44→18h00). On garde la plus proche de la signature.
  for (const c of named) {
    const key = `id:${c.id}`;
    const target = centroidOf(c);
    const idxs = sessions.flatMap((_, i) => (assignment[i] === key ? [i] : [])).sort((a, b) => ts(sessions[a].start_ts) - ts(sessions[b].start_ts));
    let kept = -1;
    for (const i of idxs) {
      if (kept >= 0 && overlapShare(sessions[kept], sessions[i]) > PARAMS.selfOverlapMax) {
        const dk = dist(feature(sessions[kept].power_w, sessions[kept].duration_min), target);
        const di = dist(feature(sessions[i].power_w, sessions[i].duration_min), target);
        const drop = di < dk ? kept : i;
        assignment[drop] = null;
        orphans.push(drop);
        if (drop === kept) kept = i;
      } else kept = i;
    }
  }
  orphans.sort((a, b) => a - b);

  const labels = dbscan(
    orphans.map((i) => feature(sessions[i].power_w, sessions[i].duration_min)),
    PARAMS.dbscanEps,
    PARAMS.dbscanMinPts,
  );

  const groups = new Map<string, number[]>();
  labels.forEach((l, k) => {
    if (l < 0) return;
    const key = `new:${l}`;
    groups.set(key, [...(groups.get(key) ?? []), orphans[k]]);
  });
  if (trainOrphans.length > 0) groups.set("new:train", trainOrphans);

  // Clusters non nommés : réutiliser l'id de l'ancien cluster le plus proche (stabilité des ids).
  const freeUnnamed = [...unnamed];
  const keyRemap = new Map<string, string>();
  const built: NewCluster[] = [];

  const stats = (idxs: number[]) => {
    const ss = idxs.map((i) => sessions[i]);
    const hourly = new Array<number>(24).fill(0);
    ss.forEach((s) => hourly[localHour(s.start_ts)]++);
    const starts = ss.map((s) => ts(s.start_ts));
    return {
      centroid_power_w: Math.round(median(ss.map((s) => s.power_w))),
      centroid_log_duration: Math.log(Math.max(median(ss.map((s) => s.duration_min)), 0.5)),
      avg_duration_min: Math.round((ss.reduce((a, s) => a + s.duration_min, 0) / ss.length) * 10) / 10,
      occurrences: ss.length,
      avg_pct_solar: Math.round((ss.reduce((a, s) => a + s.pct_solar, 0) / ss.length) * 100) / 100,
      hourly,
      first_seen: new Date(Math.min(...starts)).toISOString(),
      last_seen: new Date(Math.max(...starts)).toISOString(),
    };
  };

  // 1) Clusters nommés : mêmes ids, stats recalculées, étiquette inchangée (jamais touchée ici).
  for (const c of named) {
    const idxs = sessions.flatMap((_, i) => (assignment[i] === `id:${c.id}` ? [i] : []));
    if (idxs.length === 0) {
      continue; // rien de nouveau : on laisse la ligne telle quelle en base
    }
    built.push({ id: c.id, key: `id:${c.id}`, ...stats(idxs) });
  }

  // 2) Clusters non nommés issus de DBSCAN.
  for (const [key, idxs] of groups) {
    const st = stats(idxs);
    const f = feature(st.centroid_power_w, Math.exp(st.centroid_log_duration));
    let bestJ = -1;
    let bestD = Infinity;
    freeUnnamed.forEach((c, j) => {
      const d = dist(f, centroidOf(c));
      if (d <= PARAMS.reuseRadius && d < bestD) {
        bestD = d;
        bestJ = j;
      }
    });
    let id: number | null = null;
    if (bestJ >= 0) {
      id = freeUnnamed[bestJ].id;
      freeUnnamed.splice(bestJ, 1);
    }
    const finalKey = id != null ? `id:${id}` : key;
    keyRemap.set(key, finalKey);
    built.push({ id, key: finalKey, ...st });
  }

  const out = sessions.map((s, i) => ({
    ...s,
    cluster_key: assignment[i] ?? null,
  }));
  // Rattache les sessions orphelines à leur cluster DBSCAN (clés remappées).
  labels.forEach((l, k) => {
    if (l >= 0) out[orphans[k]].cluster_key = keyRemap.get(`new:${l}`) ?? null;
  });
  trainOrphans.forEach((i) => (out[i].cluster_key = keyRemap.get("new:train") ?? null));

  return {
    sessions: out,
    clusters: built.sort((a, b) => b.occurrences - a.occurrences),
    delete_ids: freeUnnamed.map((c) => c.id),
  };
}

export const RUNNING = {
  /**
   * Confirmation avant de compter en direct : en dessous, un préchauffage de four (même
   * puissance, 15 à 25 min) serait pris pour le chauffe-eau. Les courts sont comptés à l'arrêt.
   */
  minElapsedMin: 30,
  /** Appareil nommé candidat : durée moyenne d'au moins ça. */
  minClusterDurationMin: 60,
  /** Rattrapage des minutes de confirmation : jamais plus que la durée moyenne de l'appareil. */
  maxDurationFactor: 1,
  /**
   * Avec la puissance mesurée de la maison : en dessous de cette part de sa puissance nominale
   * au-dessus du niveau d'avant le démarrage, l'appareil est considéré arrêté (rien n'est crédité).
   * Cas réel du 08/10/2026 : chauffe-eau coupé à 13 h 22, mais un autre appareil de ~700 W a
   * retardé la détection de l'arrêt jusqu'à 14 h 20 ; il aurait été compté à sa place.
   */
  minShare: 0.5,
  /** Plafond de la puissance attribuée : un autre appareil peut s'ajouter pendant la chauffe. */
  maxShare: 1.1,
  /**
   * Appareil programmé (chauffe-eau qui démarre tous les jours vers 11 h 30) : un démarrage de sa
   * puissance à ± usualWindowMin de son heure habituelle est compté dès le relevé suivant, sans les
   * 30 min de confirmation. Celles-ci étaient sinon créditées d'un bloc dans l'heure suivante
   * (11/10/2026 : 1,07 kWh sur 12 h dont ~0,7 appartenait à 11 h, avec de la « surestimation »).
   * Seule exception à la règle « jamais l'heure » : elle ne touche que ce compteur, pas la
   * reconnaissance des appareils. Risque accepté : un four allumé pile à cette heure-là serait
   * compté comme chauffe-eau jusqu'à son arrêt.
   */
  usualWindowMin: 30,
  usualMinSessions: 5,
  usualMaxSpreadMin: 30,
  usualRecentSessions: 7,
};

/**
 * `watts` : puissance actuellement attribuée à l'appareil ; `elapsed_min` : minutes depuis le
 * démarrage (plafonnées), pour le rattrapage au tout premier relevé.
 */
/** Production réelle estimée (même formule que steps.py de fhe_solar : plancher retiré en quadrature). */
export function effectiveProductionW(watts: number): number {
  return Math.sqrt(Math.max(watts * watts - PARAMS.prodFloorW * PARAMS.prodFloorW, 0));
}

/** Soutirage réel estimé à partir de la lecture de la pince « Consommation » (voir PARAMS.consoReactiveVar). */
export function realConsumptionW(watts: number): number {
  return Math.sqrt(Math.max(watts * watts - PARAMS.consoReactiveVar * PARAMS.consoReactiveVar, 0));
}

/**
 * Puissance actuelle de la maison d'après les derniers points de la courbe FHE à 7 s
 * ([ms, soutirage W, production W]) : soutirage + production. null si la courbe est trop vieille
 * ou si la maison injecte (conso figée sous production : sa puissance est alors inconnue).
 */
export function housePowerNow(points: [number, number, number | null][], nowMs: number, maxAgeS = 300): number | null {
  const last = points.at(-1);
  if (!last || nowMs - last[0] > maxAgeS * 1000) return null;
  const prod = effectiveProductionW(last[2] ?? 0);
  const tail = points.slice(-4);
  if (prod > 0 && tail.length === 4 && tail.every((p) => p[1] === last[1])) return null;
  return realConsumptionW(last[1]) + prod;
}

/**
 * Contrôle de plausibilité des sessions contre la courbe à 7 s (audit du 11/11/2026). Les petits
 * échelons (~100 W) s'apparient au hasard sur 4 h : du 02 au 11/11/2026, 119 sessions de moins de
 * 300 W et de plus de 30 min totalisaient 35 kWh, soit 276 h de sessions pour 102 h réelles,
 * jusqu'à 14 en même temps ; plus deux fausses sessions géantes (04/11 19:01 → 22:49 à 2 293 W).
 * Règle : à chaque instant, la somme des sessions en cours ne peut pas dépasser ce que la maison
 * consomme au-dessus de son fond (prises retirées). Les sessions sont admises de la plus puissante
 * à la plus faible ; une session qui viole la règle plus de `maxBadShare` de sa durée est rejetée.
 * Rejeu sur la même période : 77 rejets (38 kWh sur 102), aucun pour le chauffe-eau, le
 * lave-linge, la bouilloire ou le micro-onde ; résultat stable de 40 à 100 W de tolérance.
 * Limite : sous une grosse chauffe, la marge de 10 % laisse passer un doublon de ~100 W.
 */
export const PLAUSIBLE = {
  /** Marqueur des sessions rejetées dans device_states (state = on_event_id). */
  device: "nilm:rejet",
  stepS: 30,
  /** Marge : max(tolAbsW, tolRel × puissance de la session) + usedSlack × sessions déjà admises. */
  tolAbsW: 60,
  tolRel: 0.25,
  /** La puissance des sessions déjà admises est connue à ~10 % près (chauffe-eau : 1 576 W retenus pour 1 660 mesurés). */
  usedSlack: 0.1,
  maxBadShare: 0.15,
  /** En dessous, la session est trop courte pour être jugée (décalage prise / courbe). */
  minMinutes: 5,
  minBins: 4,
  /** Fond de la maison : ce quantile des niveaux connus de la courbe fournie. */
  baseQuantile: 0.05,
} as const;

/** Niveau de la maison hors prises par pas de `stepS` (médiane) ; injection = inconnu (absent). */
export function houseLevels(points: [number, number, number | null][], states: DeviceState[], stepS: number = PLAUSIBLE.stepS): Map<number, number> {
  const plugs = states
    .filter((s) => s.device.startsWith(PLUG_PREFIX) && Number.isFinite(Number(s.state)))
    .map((s) => [ts(s.ts), s.device, Number(s.state)] as [number, string, number])
    .sort((a, b) => a[0] - b[0]);
  const current = new Map<string, number>();
  let pi = 0;
  let plugSum = 0;
  const bins = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const [t, conso, prod] = points[i];
    while (pi < plugs.length && plugs[pi][0] <= t) {
      plugSum += plugs[pi][2] - (current.get(plugs[pi][1]) ?? 0);
      current.set(plugs[pi][1], plugs[pi][2]);
      pi++;
    }
    // Conso figée sous production (voir steps.py de fhe_solar) : la maison injecte, niveau inconnu.
    if ((prod ?? 0) > PARAMS.prodFloorW) {
      let same = 0;
      for (let k = i - 3; k <= i + 3; k++) if (k !== i && points[k]?.[1] === conso) same++;
      if (same >= 3) continue;
    }
    const k = Math.floor(t / (stepS * 1000));
    const v = realConsumptionW(conso) + effectiveProductionW(prod ?? 0) - plugSum;
    const list = bins.get(k);
    if (list) list.push(v);
    else bins.set(k, [v]);
  }
  const out = new Map<number, number>();
  for (const [k, v] of bins) out.set(k, median(v));
  return out;
}

/**
 * on_event_id des sessions impossibles au vu de la courbe (voir PLAUSIBLE). Seules les sessions
 * entièrement couvertes par `levels` sont jugées ; `alreadyRejected` sont ignorées d'emblée.
 */
export function implausibleSessions(sessions: Session[], levels: Map<number, number>, alreadyRejected: Set<number> = new Set()): number[] {
  const P = PLAUSIBLE;
  const keys = [...levels.keys()];
  if (keys.length < 20) return [];
  const stepMs = P.stepS * 1000;
  let kMin = Infinity, kMax = -Infinity;
  for (const k of keys) { if (k < kMin) kMin = k; if (k > kMax) kMax = k; }
  const sorted = [...levels.values()].sort((a, b) => a - b);
  const base = sorted[Math.floor(sorted.length * P.baseQuantile)];
  const inside = sessions.filter((s) => !alreadyRejected.has(s.on_event_id) && s.end_ts && ts(s.start_ts) >= (kMin + 1) * stepMs && ts(s.end_ts) <= kMax * stepMs);
  const order = [...inside].sort((a, b) => b.power_w - a.power_w || a.duration_min - b.duration_min);
  const used = new Map<number, number>();
  const rejected: number[] = [];
  for (const s of order) {
    const a = ts(s.start_ts), b = ts(s.end_ts);
    let bad = 0, n = 0;
    if (s.duration_min >= P.minMinutes) {
      for (let k = Math.ceil((a + 20000) / stepMs); k <= Math.floor((b - 20000) / stepMs); k++) {
        const level = levels.get(k);
        if (level == null) continue;
        n++;
        const others = used.get(k) ?? 0;
        if (others + s.power_w > level - base + Math.max(P.tolAbsW, P.tolRel * s.power_w) + P.usedSlack * others) bad++;
      }
    }
    if (n >= P.minBins && bad / n > P.maxBadShare) {
      rejected.push(s.on_event_id);
      continue;
    }
    for (let k = Math.floor(a / stepMs); k <= Math.floor(b / stepMs); k++) used.set(k, (used.get(k) ?? 0) + s.power_w);
  }
  return rejected;
}

/** on_event_id déjà rejetés, relus dans device_states. */
export function rejectedSessionIds(states: DeviceState[]): Set<number> {
  return new Set(states.filter((s) => s.device === PLAUSIBLE.device).map((s) => Number(s.state)).filter(Number.isFinite));
}

export type RunningSession = { on_event_id: number; cluster_id: number; watts: number; elapsed_min: number };

/**
 * Appareils longs encore en marche (démarrage sans arrêt apparié), pour que le compteur HA
 * avance pendant la chauffe au lieu de tout recevoir d'un bloc à l'arrêt. Rattachement par la
 * puissance seule (la durée n'est pas encore connue), au seul appareil nommé long compatible ;
 * en cas d'hésitation, rien n'est compté avant l'arrêt.
 *
 * `housePowerW` : consommation actuelle de la maison (envoyée par HA à chaque relevé). La
 * puissance de l'appareil est alors mesurée (maison − niveau d'avant son démarrage) au lieu
 * d'être supposée constante : le chauffe-eau décroît de 1,75 à ~1,3 kW pendant sa chauffe.
 * Sans elle (ancienne config HA), on retombe sur la puissance nominale.
 */
export function runningSessions(
  merged: PowerEvent[],
  sessions: Session[],
  named: { id: number; centroid_power_w: number; avg_duration_min: number; usual_start_min?: number | null }[],
  nowMs: number,
  housePowerW: number | null = null,
  contexts: DeviceContext[] = [],
): RunningSession[] {
  const paired = new Set(sessions.map((s) => s.on_event_id));
  // Démarrage pendant une chauffe mesurée par une prise (lave-linge, lave-vaisselle) : c'est
  // elle, pas un appareil NILM. Cas réel du 24/10/2026 : chauffe du lave-linge à 17 h comptée
  // 1,4 kWh en direct comme chauffe-eau (barre négative dans HA).
  const measured = (iso: string) => {
    const t = ts(iso);
    return contexts.some(
      (ctx) => ctx.exclusiveMinPowerW != null && ctx.on.some(([a, b]) => t >= a - 120000 && t <= b),
    );
  };
  const long = named.filter((c) => c.avg_duration_min >= RUNNING.minClusterDurationMin);
  const out: RunningSession[] = [];
  for (let i = 0; i < merged.length; i++) {
    const on = merged[i];
    if (on.direction !== "on" || on.delta_w < PARAMS.levelPairMinW || paired.has(on.id)) continue;
    if (measured(on.ts)) continue;
    const elapsedMin = (nowMs - ts(on.ts)) / 60000;
    if (elapsedMin < 0 || elapsedMin * 60 > PARAMS.pairWindowS) continue;
    const nominal = revealedPowerW(merged, i, merged.length) ?? on.delta_w;
    const matches = long.filter(
      (c) => Math.abs(Math.log(nominal) - Math.log(Math.max(c.centroid_power_w, 1))) / PARAMS.powerLogScale <= PARAMS.assignRadius,
    );
    if (matches.length !== 1) continue;
    const c = matches[0];
    const atUsualTime =
      c.usual_start_min != null && Math.abs(localMinute(on.ts) - c.usual_start_min) <= RUNNING.usualWindowMin;
    if (elapsedMin < RUNNING.minElapsedMin && !atUsualTime) continue;
    let watts = nominal;
    if (housePowerW != null && Number.isFinite(housePowerW) && on.power_before != null) {
      const measured = housePowerW - on.power_before;
      watts = measured < RUNNING.minShare * nominal ? 0 : Math.min(measured, RUNNING.maxShare * nominal);
    }
    out.push({
      on_event_id: on.id,
      cluster_id: c.id,
      watts: Math.round(watts),
      elapsed_min: Math.round(Math.min(elapsedMin, c.avg_duration_min * RUNNING.maxDurationFactor) * 10) / 10,
    });
  }
  return out;
}

export function runPipeline(
  events: PowerEvent[],
  existing: ExistingCluster[],
  nowMs = Infinity,
  contexts: DeviceContext[] = [],
  states: DeviceState[] = [],
): ClusteringResult {
  const merged = subtractPlugs(mergeEvents(events), states);
  const paired = pairSessions(merged, nowMs);
  // Sessions jugées impossibles au vu de la courbe (voir PLAUSIBLE) : ni carte, ni compteur.
  const rejected = rejectedSessionIds(states);
  const sessions = rejected.size ? paired.sessions.filter((s) => !rejected.has(s.on_event_id)) : paired.sessions;
  const unpaired = paired.unpaired;
  const clustered = clusterSessions(sessions, existing, contexts);
  const noise = clustered.sessions.filter((s) => s.cluster_key == null).length;
  return {
    sessions: clustered.sessions,
    clusters: clustered.clusters,
    delete_ids: clustered.delete_ids,
    stats: {
      events: events.length,
      merged_events: merged.length,
      sessions: sessions.length,
      unpaired,
      noise,
    },
  };
}
