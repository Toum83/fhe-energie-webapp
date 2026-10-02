import { isAdmin } from "@/lib/nilm/auth";
import { dbConfigured, setLabel } from "@/lib/nilm/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin(request))) return Response.json({ error: "non autorisé" }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "FHE_WRITE_TOKEN / Supabase non configuré" }, { status: 503 });

  let body: { cluster_id?: unknown; label?: unknown; icon?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON invalide" }, { status: 400 });
  }
  const id = Number(body.cluster_id);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const icon = typeof body.icon === "string" && body.icon.length <= 8 ? body.icon : null;
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "cluster_id invalide" }, { status: 400 });
  if (label.length > 40) return Response.json({ error: "nom trop long (40 caractères max)" }, { status: 400 });

  try {
    await setLabel(id, label, icon);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}
