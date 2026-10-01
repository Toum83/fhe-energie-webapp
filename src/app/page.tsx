import Link from "next/link";
import { Delta } from "@/components/Delta";
import { DayBars } from "@/components/DayBars";
import { EnergyChart } from "@/components/EnergyChart";
import { Ring } from "@/components/Ring";
import { StatTile } from "@/components/StatTile";
import { eur, kwh, num, pct, weekLabel } from "@/lib/format";
import { fetchReports, isConfigured } from "@/lib/supabase";

// 5 min : un bilan relancé dans HA apparaît vite, et les deux pages restent cohérentes.
export const revalidate = 300;

export default async function HomePage() {
  if (!isConfigured()) {
    return (
      <Empty title="Supabase non configuré">
        Renseigne <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
        (fichier <code>.env.local</code> en local, variables d&apos;environnement sur Vercel).
      </Empty>
    );
  }

  const reports = await fetchReports(26);
  if (reports.length === 0) {
    return (
      <Empty title="Pas encore de bilan">
        Le premier bilan arrivera lundi matin, quand l&apos;automatisation Home Assistant aura
        tourné. Tu peux la déclencher à la main depuis HA pour tester.
      </Empty>
    );
  }

  const latest = reports[0];
  const previous = reports[1];
  const chartData = [...reports].reverse().map((r) => ({
    label: weekLabel(r.start_date, r.end_date),
    production: r.production_kwh,
    consumption: r.consumption_kwh,
  }));

  const gridMax = Math.max(latest.grid_import_kwh, latest.grid_export_kwh, 0.001);
  const histMax = Math.max(...reports.flatMap((r) => [r.production_kwh, r.consumption_kwh]), 0.001);
  const bestDay = latest.best_day
    ? new Date(latest.best_day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête de semaine */}
      <section className="rise flex items-end justify-between gap-3 px-1" style={{ "--i": 0 } as React.CSSProperties}>
        <div>
          <p className="eyebrow">Cette semaine</p>
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
            {weekLabel(latest.start_date, latest.end_date)}
          </h1>
        </div>
        <Link
          href={`/semaine/${latest.start_date}`}
          className="press mb-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium shadow-sm"
        >
          Détail par jour
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3l5 5-5 5" />
          </svg>
        </Link>
      </section>

      {/* Carte héros : production */}
      <section
        className="rise relative overflow-hidden rounded-[2rem] p-6 text-white shadow-[0_18px_40px_-18px_rgb(217_72_28/0.65)]"
        style={{ "--i": 1, background: "linear-gradient(150deg, var(--hero-from), var(--hero-to))" } as React.CSSProperties}
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-black/10 blur-2xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/80">Production solaire</p>
            <Delta current={latest.production_kwh} previous={previous?.production_kwh} goodWhen="up" onColor />
          </div>
          <p className="num mt-2 text-[3.6rem] leading-none">
            {num(latest.production_kwh)}
            <span className="ml-1.5 text-xl font-semibold tracking-normal text-white/80">kWh</span>
          </p>
          {bestDay ? (
            <p className="mt-2 text-sm text-white/85">
              Meilleur jour : <span className="font-semibold capitalize">{bestDay}</span> · {kwh(latest.best_day_production_kwh)}
            </p>
          ) : null}
          {latest.days?.length ? (
            <div className="mt-6">
              <DayBars days={latest.days} color="#fff" height={70} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Consommation + économies */}
      <div className="grid grid-cols-2 gap-4">
        <StatTile
          index={2}
          label="Consommation"
          accent="conso"
          value={num(latest.consumption_kwh)}
          unit="kWh"
          hint={<Delta current={latest.consumption_kwh} previous={previous?.consumption_kwh} goodWhen="down" suffix="" />}
        />
        <StatTile
          index={3}
          label="Économies"
          value={eur(latest.savings_total_eur)}
          hint={
            <>
              {eur(latest.savings_import_eur)} évités
              <br />+ {eur(latest.revenue_export_eur)} revendus
            </>
          }
        />
      </div>

      {/* Autonomie */}
      <section className="card rise p-5" style={{ "--i": 4 } as React.CSSProperties}>
        <h2 className="eyebrow mb-4">Autonomie solaire</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <Ring value={latest.self_consumption_rate} color="var(--series-auto)" label="Autoconsommation" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Autoconso.</p>
              <p className="mt-1 text-xs leading-snug text-muted">{kwh(latest.self_consumption_kwh)} consommés sur place</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <Ring value={latest.self_sufficiency_rate} color="var(--series-prod)" label="Couverture solaire" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Couverture</p>
              <p className="mt-1 text-xs leading-snug text-muted">de la conso couverte par le solaire</p>
            </div>
          </div>
        </div>
      </section>

      {/* Réseau */}
      <section className="card rise p-5" style={{ "--i": 5 } as React.CSSProperties}>
        <h2 className="eyebrow mb-4">Échanges avec le réseau</h2>
        <div className="flex flex-col gap-4">
          <FlowRow label="Soutiré" value={latest.grid_import_kwh} max={gridMax} color="var(--series-conso)" index={5} />
          <FlowRow label="Injecté" value={latest.grid_export_kwh} max={gridMax} color="var(--series-prod)" index={6} />
        </div>
      </section>

      {/* Graphique */}
      <section className="card rise p-5" style={{ "--i": 6 } as React.CSSProperties}>
        <h2 className="mb-4 text-base font-semibold tracking-tight">Semaine après semaine</h2>
        <EnergyChart data={chartData} highlightLast />
      </section>

      {/* Historique */}
      <section className="rise" style={{ "--i": 7 } as React.CSSProperties}>
        <h2 className="eyebrow mb-3 px-1">Historique</h2>
        <ul className="card divide-y divide-border overflow-hidden">
          {reports.map((r) => (
            <li key={r.start_date}>
              <Link
                href={`/semaine/${r.start_date}`}
                className="press grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 active:bg-surface-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold tracking-tight">{weekLabel(r.start_date, r.end_date)}</p>
                  <p className="mt-0.5 text-xs text-muted tabular-nums">
                    {num(r.production_kwh)} prod. · {num(r.consumption_kwh)} conso. · {pct(r.self_consumption_rate)} autoconso.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num text-sm">{eur(r.savings_total_eur)}</span>
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-faint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 3l5 5-5 5" />
                  </svg>
                </div>
                <div className="col-span-2 grid gap-1">
                  <MiniBar value={r.production_kwh} max={histMax} color="var(--series-prod)" />
                  <MiniBar value={r.consumption_kwh} max={histMax} color="var(--series-conso)" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function FlowRow({
  label,
  value,
  max,
  color,
  index,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  index: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="num text-base">{kwh(value)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="bar-x h-full rounded-full"
          style={{ "--i": index, width: `${Math.max((value / max) * 100, value > 0 ? 3 : 0)}%`, background: color } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
    </div>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card rise p-8 text-center">
      <h1 className="mb-2 text-lg font-semibold">{title}</h1>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}
