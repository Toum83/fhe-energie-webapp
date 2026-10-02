import { isAdmin } from "@/lib/nilm/auth";
import { dbConfigured } from "@/lib/nilm/db";
import { runClustering } from "@/lib/nilm/run";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdmin(request))) return Response.json({ error: "non autorisé" }, { status: 401 });
  if (!dbConfigured()) return Response.json({ error: "FHE_WRITE_TOKEN / Supabase non configuré" }, { status: 503 });
  try {
    return Response.json(await runClustering());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "erreur" }, { status: 500 });
  }
}
