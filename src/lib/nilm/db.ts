import "server-only";
import type { ExistingCluster } from "./algorithm";

/**
 * Accès Supabase du module NILM, côté serveur uniquement.
 * Pas de clé service_role (projet partagé) : clé anon + jeton d'écriture vérifié par les
 * fonctions SQL (supabase/nilm_schema.sql), envoyé en en-tête X-Fhe-Write-Token.
 * Variable Vercel serveur : FHE_WRITE_TOKEN (jamais NEXT_PUBLIC_).
 */
export const dbConfigured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.FHE_WRITE_TOKEN,
  );

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = process.env.FHE_WRITE_TOKEN;
  if (!url || !key || !token) throw new Error("Supabase / FHE_WRITE_TOKEN non configuré");
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Profile": "fhe_energy",
      "X-Fhe-Write-Token": token,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`RPC ${fn} : ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export type StoredCluster = ExistingCluster & {
  icon: string | null;
  avg_duration_min: number;
  occurrences: number;
  avg_pct_solar: number | null;
  hourly: number[];
  first_seen: string | null;
  last_seen: string | null;
};

export const fetchEvents = () => rpc<import("./algorithm").PowerEvent[]>("nilm_get_events", {});
export const fetchClusters = () => rpc<StoredCluster[]>("nilm_get_clusters", {});
export const saveClustering = (payload: unknown) => rpc<{ clusters: number; sessions: number }>("nilm_save_clustering", { payload });
export const setLabel = (clusterId: number, label: string, icon: string | null) =>
  rpc<null>("nilm_set_label", { cluster_id: clusterId, new_label: label, new_icon: icon });

export type DeviceWeek = {
  cluster_id: number;
  label: string;
  icon: string | null;
  energy_kwh: number;
  sessions: number;
  solar_share: number | null;
};
export type DeviceTotal = { cluster_id: number; label: string; icon: string | null; total_kwh: number };

/** Bilan d'une semaine (lundi) par appareil nommé. */
export const fetchWeekBreakdown = (weekStart: string) => rpc<DeviceWeek[]>("nilm_week_breakdown", { week_start: weekStart });
/**
 * Compteurs cumulés par appareil nommé, jamais décroissants (capteurs HA total_increasing).
 * `running` : appareils longs encore en marche, comptés au fur et à mesure.
 */
export async function fetchDeviceTotals(running: import("./algorithm").RunningSession[] = []) {
  try {
    return await rpc<DeviceTotal[]>("nilm_device_totals", { running_sessions: running });
  } catch {
    // Fonction SQL pas encore mise à jour (sans paramètre) : comptage à l'arrêt seulement.
    return rpc<DeviceTotal[]>("nilm_device_totals", {});
  }
}

export type RecentSession = {
  cluster_id: number | null;
  start_ts: string;
  end_ts: string;
  power_w: number;
  duration_min: number;
};
/** Dernières sessions de chaque appareil, et sessions isolées (cluster_id null). */
export const fetchRecentSessions = (perCluster = 8) => rpc<RecentSession[]>("nilm_recent_sessions", { per_cluster: perCluster });

/** Date (YYYY-MM-DD, heure de Paris) du 1er événement ; null si la fonction SQL n'est pas encore installée. */
export const fetchFirstEventDate = () => rpc<string | null>("nilm_first_event_date", {});
