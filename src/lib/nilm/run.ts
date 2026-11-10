import "server-only";
import { deviceContexts, housePowerNow, mergeEvents, washerStates, washerWindows, pairSessions, PARAMS, PLUG_PREFIX, runningSessions, runPipeline, subtractPlugs, usualStartMinute, type RunningSession } from "./algorithm";
import { fetchClusters, fetchCurve, fetchDeviceStates, fetchEvents, insertDeviceState, saveClustering } from "./db";

/** Recalcule sessions et clusters depuis tous les événements ; les clusters nommés sont préservés. */
export async function runClustering(housePowerW: number | null = null) {
  const [events, existing, states] = await Promise.all([
    fetchEvents(),
    fetchClusters(),
    fetchDeviceStates().catch(() => []), // fonction SQL pas encore installée : pas de contexte
  ]);
  const now = Date.now();
  // Lave-linge reconnu à son tambour dans les 6 dernières heures de courbe : ses périodes de
  // marche sont enregistrées comme celles d'un appareil suivi (device_states), une seule fois.
  const curve = (await fetchCurve(new Date(now - 6 * 3600000).toISOString()).catch(() => null)) ?? [];
  if (curve.length) {
    for (const st of washerStates(washerWindows(curve), states, curve[curve.length - 1][0])) {
      try {
        await insertDeviceState(st);
        states.push(st);
      } catch {
        // pas enregistré : sera retenté au prochain passage
      }
    }
  }
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
  // Depuis fhe_solar 0.6.0 les échelons sont ceux de la maison (soutirage + production) : la
  // puissance actuelle doit l'être aussi, or HA n'envoie que le soutirage. On la relit dans la
  // courbe archivée ; en injection ou sans courbe récente, elle est inconnue (puissance nominale).
  let house = housePowerW;
  if (PARAMS.houseSignalSince && now >= Date.parse(PARAMS.houseSignalSince)) {
    house = housePowerNow(curve, now);
  }
  const houseW = house == null ? null : Math.max(house - plugsNow, 0);
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
