import "server-only";
import { deviceContexts, HIDDEN_START, prepareEvents, stagedStartIds, stagedStarts, stagedStartState, hiddenStarts, houseLevels, housePowerNow, implausibleSessions, mergeEvents, PLAUSIBLE, rejectedSessionIds, washerPendingState, washerStates, washerWindows, pairSessions, PARAMS, PLUG_PREFIX, runningSessions, runPipeline, subtractPlugs, usualStartMinute, type DeviceState, type RunningSession } from "./algorithm";
import { fetchClusters, fetchCurve, fetchDeviceStates, fetchEvents, insertDeviceState, insertPowerEvent, saveClustering } from "./db";

/** Recalcule sessions et clusters depuis tous les événements ; les clusters nommés sont préservés. */
export async function runClustering(housePowerW: number | null = null) {
  const [fetched, existing, loaded] = await Promise.all([
    fetchEvents(),
    fetchClusters(),
    fetchDeviceStates().catch(() => []), // fonction SQL pas encore installée : pas de contexte
  ]);
  const states: DeviceState[] = [...loaded];
  let events = fetched;
  const now = Date.now();
  // Dernières 24 h de courbe à 7 s. Lave-linge reconnu à son tambour : ses périodes de marche
  // sont enregistrées comme celles d'un appareil suivi (device_states), une seule fois.
  const curve = (await fetchCurve(new Date(now - 24 * 3600000).toISOString()).catch(() => null)) ?? [];
  if (curve.length) {
    for (const st of washerStates(washerWindows(curve), states, curve[curve.length - 1][0])) {
      try {
        await insertDeviceState(st);
        states.push(st);
      } catch {
        // pas enregistré : sera retenté au prochain passage
      }
    }
    // Cycle en cours pas encore confirmé : allumé pour ce calcul seulement, pour que ses chauffes
    // n'aillent pas au four le temps que le tambour soit reconnu.
    const pending = washerPendingState(curve, states);
    if (pending) states.push(pending);
  }
  // Départs en deux marches (PC) : regroupés une fois, la marque garde le regroupement au-delà des 24 h.
  if (curve.length) {
    const levels = houseLevels(curve, states);
    for (const g of stagedStarts(subtractPlugs(mergeEvents(events), states), levels, stagedStartIds(states))) {
      const st = stagedStartState(g);
      try {
        await insertDeviceState(st);
        states.push(st);
      } catch {
        // pas enregistré : retenté au prochain passage
      }
    }
  }
  // Sessions impossibles au vu de la courbe : marquées une fois, puis écartées à chaque calcul.
  if (curve.length) {
    const candidates = pairSessions(prepareEvents(events, states), now).sessions;
    const byId = new Map(candidates.map((c) => [c.on_event_id, c]));
    for (const id of implausibleSessions(candidates, houseLevels(curve, states), rejectedSessionIds(states), deviceContexts(states, now))) {
      const st: DeviceState = { device: PLAUSIBLE.device, ts: byId.get(id)!.start_ts, state: String(id) };
      try {
        await insertDeviceState(st);
        states.push(st);
      } catch {
        // pas enregistré : rejugée au prochain passage
      }
    }
    // Départs cachés pendant l'injection : l'arrêt seul est visible, le départ est reconstruit
    // au milieu du gel et inséré comme un échelon ordinaire (une seule fois par arrêt).
    const rejected = rejectedSessionIds(states);
    const admitted = candidates.filter((c) => !rejected.has(c.on_event_id));
    const done = new Set(states.filter((s) => s.device === HIDDEN_START.device).map((s) => Number(s.state)));
    const merged = prepareEvents(events, states);
    let added = 0;
    for (const h of hiddenStarts(merged, admitted, houseLevels(curve, states), done)) {
      try {
        const mark: DeviceState = { device: HIDDEN_START.device, ts: h.ts, state: String(h.off_event_id) };
        await insertDeviceState(mark);
        states.push(mark);
        await insertPowerEvent({ ts: h.ts, delta_w: h.delta_w, direction: "on", power_before: h.power_before, power_after: h.power_after });
        added++;
      } catch {
        // pas enregistré : retenté au prochain passage si la marque manque
      }
    }
    if (added) events = await fetchEvents();
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
  const merged = prepareEvents(events, states);
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
