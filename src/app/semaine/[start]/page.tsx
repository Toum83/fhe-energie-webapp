import Link from "next/link";
import { notFound } from "next/navigation";
import { Delta } from "@/components/Delta";
import { DayBars } from "@/components/DayBars";
import { EnergyChart } from "@/components/EnergyChart";
import { Ring } from "@/components/Ring";
import { StatTile } from "@/components/StatTile";
import { eur, kwh, longDate, num, pct, shortWeekday, weekLabel } from "@/lib/format";
import { fetchReport, fetchReports } from "@/lib/supabase";

export const revalidate = 3600;

export default async function WeekPage({ params }: PageProps<"/semaine/[start]">) {
  const { start } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) notFound();
  const [report, all] = await Promise.all([fetchReport(start), fetchReports(52)]);
  if (!report) notFound();

  // `all` est trié du plus récent au plus ancien : index+1 = semaine précédente.
  const i = all.findIndex((r) => r.start_date === start);
  const older = i >= 0 ? all[i + 1] : undefined;
  const newer = i > 0 ? all[i - 1] : undefined;

  const chartData = report.days.map((d) => ({
    label: shortWeekday(d.date),
    production: d.production_kwh,
    consumption: d.consumption_kwh,
  }));
  const dayMax = Math.max(...report.days.flatMap((d) => [d.production_kwh, d.consumption_kwh]), 0.001);

  return (
    <div className="flex flex-col gap-4">
      {/* Navigation */}
      <section className="rise flex items-center justify-between gap-3 px-1" style={{ "--i": 0 } as React.CSSProperties}>
        <Link
          href="/"
          className="press inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-2 text-sm font-medium shadow-sm"
        >
          <Chevron dir="left" />
          Semaines
        </Link>
        <div className="flex items-center gap-2">
          <NavButton href={older ? `/semaine/${older.start_date}` : null} dir="left" label="Semaine précédente" />
          <NavButton href={newer ? `/semaine/${newer.start_date}` : null} dir="right" label="Semaine suivante" />
        </div>
      </section>

      <section className="rise px-1" style={{ "--i": 1 } as React.CSSProperties}>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
          {weekLabel(report.start_date, report.end_date)}
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Du {longDate(report.start_date)} au {longDate(report.end_date)}
        </p>
      </section>

      {/* Carte héros */}
      <section
        className="rise relative overflow-hidden rounded-[2rem] p-6 text-white shadow-[0_18px_40px_-18px_rgb(217_72_28/0.65)]"
        style={{ "--i": 2, background: "linear-gradient(150deg, var(--hero-from), var(--hero-to))" } as React.CSSProperties}
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/80">Production solaire</p>
            <Delta current={report.production_kwh} previous={older?.production_kwh} goodWhen="up" onColor />
          </div>
          <p className="num mt-2 text-[3.6rem] leading-none">
            {num(report.production_kwh)}
            <span className="ml-1.5 text-xl font-semibold tracking-normal text-white/80">kWh</span>
          </p>
          <div className="mt-6">
            <DayBars days={report.days} color="#fff" height={70} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <StatTile
          index={3}
          label="Consommation"
          accent="conso"
          value={num(report.consumption_kwh)}
          unit="kWh"
          hint={<Delta current={report.consumption_kwh} previous={older?.consumption_kwh} goodWhen="down" suffix="" />}
        />
        <StatTile
          index={4}
          label="Économies"
          value={eur(report.savings_total_eur)}
          hint={
            <>
              {eur(report.savings_import_eur)} évités
              <br />+ {eur(report.revenue_export_eur)} de surplus
            </>
          }
        />
      </div>

      <section className="card rise p-5" style={{ "--i": 5 } as React.CSSProperties}>
        <h2 className="eyebrow mb-4">Autonomie solaire</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <Ring value={report.self_consumption_rate} color="var(--series-auto)" label="Autoconsommation" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Autoconso.</p>
              <p className="mt-1 text-xs leading-snug text-muted">part de la production consommée sur place</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <Ring value={report.self_sufficiency_rate} color="var(--series-prod)" label="Couverture solaire" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Couverture</p>
              <p className="mt-1 text-xs leading-snug text-muted">de la conso couverte par le solaire</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card rise p-5" style={{ "--i": 6 } as React.CSSProperties}>
        <h2 className="mb-4 text-base font-semibold tracking-tight">Jour par jour</h2>
        <EnergyChart data={chartData} height={220} />
      </section>

      {/* Détail par jour */}
      <section className="rise" style={{ "--i": 7 } as React.CSSProperties}>
        <h2 className="eyebrow mb-3 px-1">Détail</h2>
        <ul className="card divide-y divide-border overflow-hidden">
          {report.days.map((d) => (
            <li key={d.date} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold capitalize tracking-tight">{shortWeekday(d.date)}</p>
                <p className="num text-sm text-muted">{pct(d.self_consumption_rate)} autoconso.</p>
              </div>
              <div className="mt-2.5 grid gap-1.5">
                <DayLine label="Prod." value={d.production_kwh} max={dayMax} color="var(--series-prod)" />
                <DayLine label="Conso." value={d.consumption_kwh} max={dayMax} color="var(--series-conso)" />
              </div>
              <p className="mt-2.5 text-xs tabular-nums text-muted">
                Autoconsommé {kwh(d.self_consumption_kwh)} · soutiré {kwh(d.grid_import_kwh)} · injecté {kwh(d.grid_export_kwh)}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 px-1 text-xs leading-relaxed text-faint">
          Tarifs : {report.price_import.toFixed(4)} €/kWh acheté ; surplus revendu {report.price_export.toFixed(2)} €/kWh
          {report.price_export_above != null
            ? ` jusqu'au plafond annuel, puis ${report.price_export_above.toFixed(2)} €/kWh`
            : ""}
          {report.export_cap_remaining_kwh != null
            ? ` (${kwh(report.export_cap_remaining_kwh)} restants sous plafond)`
            : ""}
          . Soutirage payé : {eur(report.grid_cost_eur)}. Autoconso = part de la production consommée sur place.
        </p>
      </section>
    </div>
  );
}

function DayLine({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
      <span className="num w-20 text-right text-sm">{kwh(value)}</span>
    </div>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
}

function NavButton({ href, dir, label }: { href: string | null; dir: "left" | "right"; label: string }) {
  const cls = "grid h-10 w-10 place-items-center rounded-full border border-border bg-surface shadow-sm";
  if (!href)
    return (
      <span aria-label={label} aria-disabled className={`${cls} opacity-35`}>
        <Chevron dir={dir} />
      </span>
    );
  return (
    <Link href={href} aria-label={label} className={`${cls} press`}>
      <Chevron dir={dir} />
    </Link>
  );
}
