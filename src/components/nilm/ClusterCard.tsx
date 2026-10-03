"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type ClusterView = {
  id: number;
  label: string | null;
  icon: string | null;
  centroid_power_w: number;
  avg_duration_min: number;
  occurrences: number;
  avg_pct_solar: number | null;
  hourly: number[];
  last_seen: string | null;
};

const ICONS = ["🔥", "🚿", "🧺", "🍽️", "🍳", "☕", "📺", "💻", "❄️", "🔌"];
const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function duration(min: number) {
  if (min < 60) return `${nf.format(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Piste de nom, uniquement indicative (puissance + durée). */
function hint(power: number, minutes: number): string | null {
  if (power >= 1400 && minutes >= 90) return "chauffe-eau, lave-linge, lave-vaisselle ?";
  if (power >= 1400 && minutes <= 30) return "four, plaque, bouilloire, micro-ondes ?";
  if (power >= 1000 && minutes < 90) return "plaque, four, sèche-cheveux, sèche-linge ?";
  if (power >= 150 && power <= 700 && minutes >= 45) return "télé, ordinateur, congélateur, box ?";
  if (power >= 150 && power < 1000 && minutes < 45) return "aspirateur, petit électroménager ?";
  return null;
}

export function ClusterCard({ cluster, index }: { cluster: ClusterView; index: number }) {
  const router = useRouter();
  const [label, setLabel] = useState(cluster.label ?? "");
  const [icon, setIcon] = useState<string | null>(cluster.icon);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const maxHour = Math.max(...cluster.hourly, 1);
  const named = Boolean(cluster.label);
  const tip = hint(cluster.centroid_power_w, cluster.avg_duration_min);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/nilm/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster_id: cluster.id, label, icon }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
      setState("saved");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setState("error");
    }
  }

  return (
    <article className="card rise p-5" style={{ "--i": index } as React.CSSProperties}>
      <header className="flex items-start gap-3">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-xl">
          {cluster.icon ?? "❔"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold tracking-tight">{named ? cluster.label : `Appareil n°${cluster.id}`}</h3>
          <p className="text-xs text-muted">{named ? `Nommé · n°${cluster.id}` : "À nommer"}</p>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat value={`${nf.format(cluster.centroid_power_w)} W`} label="puissance" />
        <Stat value={duration(cluster.avg_duration_min)} label="durée moy." />
        <Stat value={`${cluster.occurrences}×`} label="détecté" />
      </div>

      {cluster.occurrences < 5 ? (
        <p className="mt-3 rounded-xl bg-[color-mix(in_oklab,#f5a524_16%,transparent)] px-3 py-2 text-xs text-muted">
          Peu d&apos;occurrences : signature encore peu fiable. Elle se précisera avec le temps.
        </p>
      ) : null}

      <div className="mt-4">
        <div className="flex h-14 items-end gap-[3px]" role="img" aria-label="Répartition par heure de la journée">
          {cluster.hourly.map((n, h) => (
            <div
              key={h}
              className="flex-1 rounded-sm bg-prod"
              style={{ height: `${Math.max((n / maxHour) * 100, n ? 8 : 3)}%`, opacity: n ? 1 : 0.18 }}
              title={`${h} h : ${n}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>0 h</span>
          <span>6 h</span>
          <span>12 h</span>
          <span>18 h</span>
          <span>24 h</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Heures de démarrage (à titre indicatif, jamais utilisées pour reconnaître l&apos;appareil)
          {cluster.avg_pct_solar != null ? ` · environ ${Math.round(cluster.avg_pct_solar * 100)} % de sa consommation couverte par le solaire (estimation haute)` : ""}.
        </p>
      </div>

      <form onSubmit={save} className="mt-5 flex flex-col gap-3">
        {tip && !named ? <p className="text-xs text-muted">Ça ressemble à : {tip}</p> : null}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icône">
          {ICONS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIcon(icon === i ? null : i)}
              aria-pressed={icon === i}
              className={`press grid h-9 w-9 place-items-center rounded-xl text-lg ${icon === i ? "bg-foreground/10 ring-2 ring-foreground/30" : "bg-surface-2"}`}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setState("idle");
            }}
            maxLength={40}
            placeholder="Ex. Chauffe-eau"
            aria-label="Nom de l'appareil"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-base outline-none focus:border-foreground/40"
          />
          <button
            type="submit"
            disabled={state === "saving"}
            className="press rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-60"
          >
            {state === "saving" ? "…" : named ? "Renommer" : "Nommer"}
          </button>
        </div>
        {state === "saved" ? <p className="text-xs text-auto">Enregistré.</p> : null}
        {state === "error" ? <p className="text-xs text-[#e5484d]">{error}</p> : null}
      </form>
    </article>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
      <div className="num text-base">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
