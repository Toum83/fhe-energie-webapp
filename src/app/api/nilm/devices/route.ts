import { isAdmin } from "@/lib/nilm/auth";
import { dbConfigured, fetchDeviceTotals } from "@/lib/nilm/db";
import { runClustering } from "@/lib/nilm/run";

export const dynamic = "force-dynamic";

/**
 * Lu par Home Assistant toutes les 15 min (plateforme rest, en-tête Authorization: Bearer
 * NILM_ADMIN_TOKEN, paramètre ?p= : consommation actuelle de la maison en W). Recalcule d'abord les sessions pour que les compteurs suivent la journée,
 * puis renvoie l'énergie cumulée de chaque appareil nommé (jamais décroissante).
 */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) return Response.json({ error: "non autorisé" }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "FHE_WRITE_TOKEN / Supabase non configuré" }, { status: 503 });
  try {
    const raw = new URL(request.url).searchParams.get("p");
    const p = raw != null && raw.trim() !== "" ? Number(raw) : NaN;
    const housePowerW = Number.isFinite(p) && p >= 0 && p <= 50000 ? p : null;
    const { running } = await runClustering(housePowerW);
    const devices = await fetchDeviceTotals(running);
    const by_id = Object.fromEntries(devices.map((d) => [String(d.cluster_id), Number(d.total_kwh)]));
    return Response.json({ devices, by_id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}
