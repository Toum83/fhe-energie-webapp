import "server-only";
import { runPipeline } from "./algorithm";
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
  return { stats: result.stats, saved };
}
