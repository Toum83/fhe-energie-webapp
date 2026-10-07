import "server-only";
import { mergeEvents, pairSessions, runningSessions, runPipeline, type RunningSession } from "./algorithm";
import { fetchClusters, fetchEvents, saveClustering } from "./db";

/** Recalcule sessions et clusters depuis tous les événements ; les clusters nommés sont préservés. */
export async function runClustering() {
  const [events, existing] = await Promise.all([fetchEvents(), fetchClusters()]);
  const result = runPipeline(events, existing);
  const saved = await saveClustering({
    clusters: result.clusters,
    sessions: result.sessions,
    delete_ids: result.delete_ids,
  });
  // Appareils longs encore en marche, pour faire avancer les compteurs HA pendant la chauffe.
  const merged = mergeEvents(events);
  const named = existing
    .filter((c) => c.label && c.label.trim())
    .map((c) => ({ id: c.id, centroid_power_w: Number(c.centroid_power_w), avg_duration_min: Number(c.avg_duration_min) }));
  const running: RunningSession[] = runningSessions(merged, pairSessions(merged).sessions, named, Date.now());
  return { stats: result.stats, saved, running };
}
