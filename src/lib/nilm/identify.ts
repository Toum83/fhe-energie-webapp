// « C'était quoi ? » : sessions récentes d'appareils pas encore nommés, à faire identifier.
// Fonction pure, testée.

export type IdentifySession = {
  cluster_id: number | null;
  start_ts: string;
  end_ts: string;
  power_w: number;
  duration_min: number;
};

/**
 * Sessions des dernières `hours` heures qui appartiennent à une carte sans nom, des plus récentes
 * aux plus anciennes. Les toutes petites (< `minKwh`) sont écartées : bruit, veilles. Les sessions
 * isolées (sans carte) ne peuvent pas être nommées, elles ne sont pas proposées.
 */
export function toIdentify(
  sessions: IdentifySession[],
  namedIds: Set<number>,
  nowMs: number,
  { hours = 48, minKwh = 0.05, limit = 12 } = {},
): IdentifySession[] {
  const since = nowMs - hours * 3600_000;
  return sessions
    .filter(
      (s) =>
        s.cluster_id != null &&
        !namedIds.has(s.cluster_id) &&
        new Date(s.start_ts).getTime() >= since &&
        (Number(s.power_w) * Number(s.duration_min)) / 60000 >= minKwh,
    )
    .sort((a, b) => new Date(b.start_ts).getTime() - new Date(a.start_ts).getTime())
    .slice(0, limit);
}
