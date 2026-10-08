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
  /** Deux événements de même sens à moins de ça sont un seul échelon étalé sur 2 relevés. */
  mergeWindowS: 330,
  /** Au-delà, un ON sans OFF correspondant est abandonné. */
  pairWindowS: 4 * 3600,
  /** Tolérance de magnitude entre un ON et son OFF : max(35 % du ON, 250 W). */
  pairRelTol: 0.35,
  pairAbsTolW: 250,
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
  dbscanEps: 1,
  dbscanMinPts: 3,
  /** Reprise d'un cluster non nommé existant si son centroïde est à <= 1. */
  reuseRadius: 1,
  timeZone: "Europe/Paris",
} as const;

const ts = (iso: string) => new Date(iso).getTime();

/** Fusionne les événements de même sens très rapprochés (même échelon vu sur 2 relevés). */
export function mergeEvents(events: PowerEvent[]): PowerEvent[] {
  const sorted = [...events].sort((a, b) => ts(a.ts) - ts(b.ts) || a.id - b.id);
  const out: PowerEvent[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.direction === e.direction &&
      (ts(e.ts) - ts(last.ts)) / 1000 <= PARAMS.mergeWindowS
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

/**
 * Apparie chaque ON avec le prochain OFF de magnitude la plus proche (pas le premier trouvé),
 * dans une fenêtre de 4 h. Retourne les sessions et le nombre d'événements non appariés.
 */
export function pairSessions(merged: PowerEvent[]): { sessions: Session[]; unpaired: number } {
  const used = new Set<number>();
  const sessions: Session[] = [];
  for (let i = 0; i < merged.length; i++) {
    const on = merged[i];
    if (on.direction !== "on" || on.delta_w <= 0) continue;
    let best: { err: number; j: number } | null = null;
    const byLevel = on.delta_w >= PARAMS.levelPairMinW && on.power_before != null;
    if (byLevel) {
      // Premier OFF qui ramène la puissance au niveau d'avant le démarrage.
      const ceiling = on.power_before! + Math.max(PARAMS.levelRelTol * on.delta_w, PARAMS.levelAbsTolW);
      for (let j = i + 1; j < merged.length; j++) {
        const off = merged[j];
        if ((ts(off.ts) - ts(on.ts)) / 1000 > PARAMS.pairWindowS) break;
        if (off.direction !== "off" || used.has(j)) continue;
        if (off.power_after != null && off.power_after <= ceiling) {
          best = { err: 0, j };
          break;
        }
      }
    }
    if (!best) {
      for (let j = i + 1; j < merged.length; j++) {
        const off = merged[j];
        if ((ts(off.ts) - ts(on.ts)) / 1000 > PARAMS.pairWindowS) break;
        if (off.direction !== "off" || used.has(j)) continue;
        const err = Math.abs(-off.delta_w - on.delta_w);
        if (err <= Math.max(PARAMS.pairRelTol * on.delta_w, PARAMS.pairAbsTolW) && (!best || err < best.err)) {
          best = { err, j };
        }
      }
    }
    if (!best) continue;
    const off = merged[best.j];
    used.add(best.j);
    const durationMin = (ts(off.ts) - ts(on.ts)) / 60000;
    let powerW = byLevel && best.err === 0 ? on.delta_w : (on.delta_w + -off.delta_w) / 2;
    if (byLevel && best.err === 0 && durationMin >= PARAMS.revealMinMinutes) {
      const revealed = revealedPowerW(merged, i, best.j);
      if (revealed != null) powerW = revealed;
    }
    // Un simple seuil de production (ex. > 50 W) comptait comme « solaire » un four de 1,7 kW
    // lancé au crépuscule avec 120 W de production : on mesure plutôt la part couverte.
    const coverage = (e: PowerEvent) => Math.min(Math.max(e.production_power ?? 0, 0) / Math.max(powerW, 1), 1);
    sessions.push({
      on_event_id: on.id,
      off_event_id: off.id,
      start_ts: on.ts,
      end_ts: off.ts,
      // Arrêt par paliers : seul le démarrage reflète la puissance nominale.
      power_w: Math.round(powerW),
      duration_min: Math.round(durationMin * 10) / 10,
      pct_solar: Math.round(((coverage(on) + coverage(off)) / 2) * 100) / 100,
    });
  }
  const onCount = merged.filter((e) => e.direction === "on").length;
  const offCount = merged.filter((e) => e.direction === "off").length;
  const unpaired = onCount - sessions.length + (offCount - sessions.length);
  return { sessions, unpaired };
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
export function clusterSessions(sessions: Session[], existing: ExistingCluster[]): Omit<ClusteringResult, "stats"> {
  const named = existing.filter((c) => c.label && c.label.trim() !== "");
  const unnamed = existing.filter((c) => !c.label || c.label.trim() === "");

  const assignment = new Array<string | null>(sessions.length).fill(null);
  const orphans: number[] = [];
  const centroidOf = (c: ExistingCluster): Feature => [
    Math.log(Math.max(c.centroid_power_w, 1)) / PARAMS.powerLogScale,
    c.centroid_log_duration / PARAMS.durationLogScale,
  ];

  sessions.forEach((s, i) => {
    const f = feature(s.power_w, s.duration_min);
    let best: { d: number; c: ExistingCluster } | null = null;
    for (const c of named) {
      const d = dist(f, centroidOf(c));
      if (d <= PARAMS.assignRadius && (!best || d < best.d)) best = { d, c };
    }
    if (best) assignment[i] = `id:${best.c.id}`;
    else orphans.push(i);
  });

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
};

/**
 * `watts` : puissance actuellement attribuée à l'appareil ; `elapsed_min` : minutes depuis le
 * démarrage (plafonnées), pour le rattrapage au tout premier relevé.
 */
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
  named: { id: number; centroid_power_w: number; avg_duration_min: number }[],
  nowMs: number,
  housePowerW: number | null = null,
): RunningSession[] {
  const paired = new Set(sessions.map((s) => s.on_event_id));
  const long = named.filter((c) => c.avg_duration_min >= RUNNING.minClusterDurationMin);
  const out: RunningSession[] = [];
  for (let i = 0; i < merged.length; i++) {
    const on = merged[i];
    if (on.direction !== "on" || on.delta_w < PARAMS.levelPairMinW || paired.has(on.id)) continue;
    const elapsedMin = (nowMs - ts(on.ts)) / 60000;
    if (elapsedMin < RUNNING.minElapsedMin || elapsedMin * 60 > PARAMS.pairWindowS) continue;
    const nominal = revealedPowerW(merged, i, merged.length) ?? on.delta_w;
    const matches = long.filter(
      (c) => Math.abs(Math.log(nominal) - Math.log(Math.max(c.centroid_power_w, 1))) / PARAMS.powerLogScale <= PARAMS.assignRadius,
    );
    if (matches.length !== 1) continue;
    const c = matches[0];
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

export function runPipeline(events: PowerEvent[], existing: ExistingCluster[]): ClusteringResult {
  const merged = mergeEvents(events);
  const { sessions, unpaired } = pairSessions(merged);
  const clustered = clusterSessions(sessions, existing);
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
