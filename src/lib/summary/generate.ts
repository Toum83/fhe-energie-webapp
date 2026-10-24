import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

/**
 * Synthèse de la semaine rédigée par Claude, écrite une fois puis relue (table
 * fhe_energy.weekly_summaries, supabase/summary_schema.sql).
 *
 * Générée à la première visite d'une semaine terminée, quand GRDF a eu le temps de publier
 * le gaz. Sans ANTHROPIC_API_KEY ou FHE_WRITE_TOKEN (variables Vercel serveur), ou si l'appel
 * échoue, la page s'affiche simplement sans synthèse.
 */
export const SUMMARY_MODEL = "claude-haiku-5-5";

/** Jours d'attente après la fin de semaine : le gaz GRDF arrive avec 1 à 2 jours de retard. */
const GAS_DELAY_DAYS = 2;

const SYSTEM = `Tu rédiges la synthèse hebdomadaire du bilan énergie d'une maison en France : panneaux
solaires, consommation électrique, et chauffage au gaz (chaudière, plus des plaques de cuisson au gaz).
L'eau chaude est électrique (chauffe-eau, dont un thermodynamique).

Écris en français, en vouvoyant, 4 à 6 phrases en un ou deux paragraphes de texte brut : pas de
titre, pas de liste, pas de markdown. Dis ce qui ressort de la semaine (évolution par rapport à la
précédente, meilleur et pire jour, appareils qui pèsent le plus, gaz), puis termine par un conseil
concret et faisable la semaine suivante, par exemple décaler un appareil vers les heures de soleil.

N'utilise que les chiffres fournis, arrondis, sans en inventer ni en recalculer de nouveaux. Les
kWh par appareil sont des estimations basses, sauf ceux « mesuré par prise ». Si une donnée manque,
n'en parle pas.`;

function paris(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);
}

/** La semaine (lundi → dimanche `endDate`) est-elle assez ancienne pour être résumée ? */
export function summaryDue(endDate: string, now = new Date()): boolean {
  const due = new Date(`${endDate}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + GAS_DELAY_DAYS);
  return paris(now) >= due.toISOString().slice(0, 10);
}

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false }, db: { schema: "fhe_energy" } }) : null;
}

async function stored(weekStart: string): Promise<string | null> {
  const supabase = client();
  if (!supabase) return null;
  const { data, error } = await supabase.from("weekly_summaries").select("summary").eq("week_start", weekStart).maybeSingle();
  if (error) return null; // table pas encore créée
  return (data as { summary: string } | null)?.summary ?? null;
}

async function save(weekStart: string, summary: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${url}/rest/v1/rpc/save_weekly_summary`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Content-Profile": "fhe_energy",
      "X-Fhe-Write-Token": process.env.FHE_WRITE_TOKEN!,
    },
    body: JSON.stringify({ week_start: weekStart, summary, model: SUMMARY_MODEL }),
  });
  if (!res.ok) throw new Error(`save_weekly_summary : ${res.status}`);
}

async function write(facts: string): Promise<string | null> {
  const anthropic = new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const response = await anthropic.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: `Chiffres de la semaine :\n\n${facts}` }],
  });
  if (response.stop_reason !== "end_turn") return null; // refus ou texte tronqué : pas de synthèse
  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  return text || null;
}

/** Synthèse existante, ou écrite maintenant si la semaine est due. null sinon (ou en cas d'erreur). */
export async function weekSummary(weekStart: string, endDate: string, facts: () => string): Promise<string | null> {
  try {
    const existing = await stored(weekStart);
    if (existing) return existing;
    if (!summaryDue(endDate) || !process.env.ANTHROPIC_API_KEY || !process.env.FHE_WRITE_TOKEN) return null;
    const text = await write(facts());
    if (text) await save(weekStart, text);
    return text;
  } catch (err) {
    console.error("Synthèse de la semaine indisponible :", err instanceof Error ? err.message : err);
    return null;
  }
}
