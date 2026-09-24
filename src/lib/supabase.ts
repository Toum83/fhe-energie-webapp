import { createClient } from "@supabase/supabase-js";
import { MOCK_REPORTS } from "./mock";
import type { WeeklyReport } from "./types";

const isMockMode = () => process.env.MOCK_DATA === "1";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // Projet Supabase partagé avec d'autres apps (ex. app trail) : tout vit
  // dans le schéma fhe_energy, jamais public — voir supabase/schema.sql.
  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "fhe_energy" },
  });
}

/** Tous les bilans, du plus récent au plus ancien. */
export async function fetchReports(limit = 52): Promise<WeeklyReport[]> {
  if (isMockMode()) return MOCK_REPORTS.slice(0, limit);
  const supabase = getClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .order("start_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as WeeklyReport[];
}

export async function fetchReport(startDate: string): Promise<WeeklyReport | null> {
  if (isMockMode()) return MOCK_REPORTS.find((r) => r.start_date === startDate) ?? null;
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("weekly_reports")
    .select("*")
    .eq("start_date", startDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WeeklyReport | null) ?? null;
}

export const isConfigured = () =>
  isMockMode() ||
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
