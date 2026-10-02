"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Summary = { stats: { events: number; sessions: number; unpaired: number; noise: number }; saved: { clusters: number } };

export function RunButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("running");
    setMessage(null);
    try {
      const res = await fetch("/api/nilm/cluster", { method: "POST" });
      const data = (await res.json()) as Summary & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setMessage(
        `${data.stats.events} événements → ${data.stats.sessions} sessions, ${data.saved.clusters} appareils (${data.stats.noise} sessions isolées)`,
      );
      setState("idle");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erreur");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="press inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background shadow-sm disabled:opacity-60"
      >
        {state === "running" ? "Analyse en cours…" : "Relancer le regroupement"}
      </button>
      {message ? (
        <p className={`text-xs ${state === "error" ? "text-[#e5484d]" : "text-muted"}`} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
