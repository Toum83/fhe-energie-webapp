import "server-only";
import { deviceContexts, mergeEvents, pairSessions, PLUG_PREFIX, runningSessions, runPipeline, subtractPlugs, usualStartMinute, type RunningSession } from "./algorithm";
import { fetchClusters, fetchDeviceStates, fetchEvents, saveClustering } from "./db";

/** Recalcule sessions et clusters depuis tous les événements ; les clusters nommés sont préservés. */
export async function runClustering(housePowerW: number | null = null) {
  const [events, existing, states] = await Promise.all([
    fetchEvents(),
    fetchClusters(),
    fetchDeviceStates().catch(() => []), // fonction SQL pas encore installée : pas de contexte
  ]);
  const now = Date.now();
  const contexts = deviceContexts(states, now);
  const result = runPipeline(events, existing, now, contexts, states);
  const saved = await saveClustering({
    clusters: result.clusters,
    sessions: result.sessions,
    delete_ids: result.delete_ids,
  });
  // Appareils longs encore en marche, pour faire avancer les compteurs HA pendant la chauffe.
  // Prises mesurées retirées, des échelons comme de la puissance actuelle de la maison.
  const merged = subtractPlugs(mergeEvents(events), states);
  const plugsNow = [...new Set(states.filter((s) => s.device.startsWith(PLUG_PREFIX)).map((s) => s.device))]
    .map((d) => Number(states.filter((s) => s.device === d).at(-1)?.state))
    .filter(Number.isFinite)
    .reduce((a, w) => a + w, 0);
  const houseW = housePowerW == null ? null : Math.max(housePowerW - plugsNow, 0);
  const named = existing
    .filter((c) => c.label && c.label.trim())
    .map((c) => ({
      id: c.id,
      centroid_power_w: Number(c.centroid_power_w),
      avg_duration_min: Number(c.avg_duration_min),
      usual_start_min: usualStartMinute(result.sessions.filter((s) => s.cluster_key === `id:${c.id}`).map((s) => s.start_ts)),
    }));
  const running: RunningSession[] = runningSessions(merged, pairSessions(merged, now).sessions, named, now, houseW, contexts);
  return { stats: result.stats, saved, running };
}
