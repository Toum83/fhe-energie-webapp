import Link from "next/link";
import { notFound } from "next/navigation";
import { EnergyChart } from "@/components/EnergyChart";
import { StatTile } from "@/components/StatTile";
import { eur, kwh, longDate, pct, shortWeekday, weekLabel } from "@/lib/format";
import { fetchReport } from "@/lib/supabase";

export const revalidate = 3600;

export default async function WeekPage({ params }: PageProps<"/semaine/[start]">) {
  const { start } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) notFound();
  const report = await fetchReport(start);
  if (!report) notFound();

  const chartData = report.days.map((d) => ({
    label: shortWeekday(d.date),
    production: d.production_kwh,
    consumption: d.consumption_kwh,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/" className="text-sm text-muted underline-offset-4 hover:underline">
          ← Toutes les semaines
        </Link>
        <h1 className="mt-2 text-lg font-semibold">
          Semaine du {weekLabel(report.start_date, report.end_date)}
        </h1>
        <p className="text-sm text-muted">
          Du {longDate(report.start_date)} au {longDate(report.end_date)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Production" value={kwh(report.production_kwh)} accent="prod" />
        <StatTile label="Consommation" value={kwh(report.consumption_kwh)} accent="conso" />
        <StatTile
          label="Autoconso."
          value={pct(report.self_consumption_rate)}
          hint={`${pct(report.self_sufficiency_rate)} de la conso couverte`}
          accent="auto"
        />
        <StatTile
          label="Économies"
          value={eur(report.savings_total_eur)}
          hint={`${eur(report.savings_import_eur)} évités + ${eur(report.revenue_export_eur)} de surplus`}
        />
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium text-muted">Par jour (kWh)</h2>
        <EnergyChart data={chartData} height={240} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Détail</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Jour</th>
                <th className="px-4 py-2 text-right font-medium">Prod.</th>
                <th className="px-4 py-2 text-right font-medium">Conso.</th>
                <th className="px-4 py-2 text-right font-medium">Autoconso.</th>
                <th className="px-4 py-2 text-right font-medium">Soutiré</th>
                <th className="px-4 py-2 text-right font-medium">Injecté</th>
                <th className="px-4 py-2 text-right font-medium">Taux</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.days.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="px-4 py-2 capitalize">{shortWeekday(d.date)}</td>
                  <td className="px-4 py-2 text-right">{kwh(d.production_kwh)}</td>
                  <td className="px-4 py-2 text-right">{kwh(d.consumption_kwh)}</td>
                  <td className="px-4 py-2 text-right">{kwh(d.self_consumption_kwh)}</td>
                  <td className="px-4 py-2 text-right">{kwh(d.grid_import_kwh)}</td>
                  <td className="px-4 py-2 text-right">{kwh(d.grid_export_kwh)}</td>
                  <td className="px-4 py-2 text-right">{pct(d.self_consumption_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-faint">
          Tarifs : {report.price_import.toFixed(4)} €/kWh acheté ; surplus revendu{" "}
          {report.price_export.toFixed(2)} €/kWh
          {report.price_export_above != null
            ? ` jusqu'au plafond annuel, puis ${report.price_export_above.toFixed(2)} €/kWh`
            : ""}
          {report.export_cap_remaining_kwh != null
            ? ` (${kwh(report.export_cap_remaining_kwh)} restants sous plafond)`
            : ""}
          . Soutirage payé : {eur(report.grid_cost_eur)}. Taux = part de la production consommée sur
          place.
        </p>
      </section>
    </div>
  );
}
