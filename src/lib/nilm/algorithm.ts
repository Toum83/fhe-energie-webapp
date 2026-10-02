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
  /** Part de la session pendant la production solaire (0..1), d'après les 2 événements. */
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
  solarThresholdW: 50,
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
      // On garde l'id du premier ; l'instant final et l'amplitude cumulée.
      out[out.length - 1] = {
        ...last,
        delta_w: last.delta_w + e.delta_w,
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
    for (let j = i + 1; j < merged.length; j++) {
      const off = merged[j];
      if ((ts(off.ts) - ts(on.ts)) / 1000 > PARAMS.pairWindowS) break;
      if (off.direction !== "off" || used.has(j)) continue;
      const err = Math.abs(-off.delta_w - on.delta_w);
      if (err <= Math.max(PARAMS.pairRelTol * on.delta_w, PARAMS.pairAbsTolW) && (!best || err < best.err)) {
        best = { err, j };
      }
    }
    if (!best) continue;
    const off = merged[best.j];
    used.add(best.j);
    const durationMin = (ts(off.ts) - ts(on.ts)) / 60000;
    const solarPoints = [on, off].filter((e) => (e.production_power ?? 0) > PARAMS.solarThresholdW).length;
    sessions.push({
      on_event_id: on.id,
      off_event_id: off.id,
      start_ts: on.ts,
      end_ts: off.ts,
      power_w: Math.round((on.delta_w + -off.delta_w) / 2),
      duration_min: Math.round(durationMin * 10) / 10,
      pct_solar: solarPoints / 2,
    });
  }
  const onCount = merged.filter((e) => e.direction === "on").length;
  const offCount = merged.filter((e) => e.direction === "off").length;
  const unpaired = onCount - sessions.length + (offCount - sessions.length);
  return { sessions, unpaired };
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
