import Link from "next/link";
import { EnergyChart } from "@/components/EnergyChart";
import { StatTile } from "@/components/StatTile";
import { eur, kwh, pct, weekLabel } from "@/lib/format";
import { fetchReports, isConfigured } from "@/lib/supabase";

export const revalidate = 3600;

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
  const chartData = [...reports]
    .reverse()
    .map((r) => ({
      label: weekLabel(r.start_date, r.end_date),
      production: r.production_kwh,
      consumption: r.consumption_kwh,
    }));

  const delta = (key: "production_kwh" | "consumption_kwh" | "savings_total_eur") => {
    if (!previous || !previous[key]) return undefined;
    const d = ((latest[key] - previous[key]) / previous[key]) * 100;
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(0)} % vs semaine précédente`;
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">
            Semaine du {weekLabel(latest.start_date, latest.end_date)}
          </h1>
          <Link href={`/semaine/${latest.start_date}`} className="text-sm text-muted underline-offset-4 hover:underline">
            Détail par jour →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Production" value={kwh(latest.production_kwh)} hint={delta("production_kwh")} accent="prod" />
          <StatTile label="Consommation" value={kwh(latest.consumption_kwh)} hint={delta("consumption_kwh")} accent="conso" />
          <StatTile
            label="Autoconso."
            value={pct(latest.self_consumption_rate)}
            hint={`${kwh(latest.self_consumption_kwh)} consommés sur place`}
            accent="auto"
          />
          <StatTile label="Économies" value={eur(latest.savings_total_eur)} hint={delta("savings_total_eur")} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Le solaire a couvert <strong className="text-foreground">{pct(latest.self_sufficiency_rate)}</strong> de la
          consommation. Réseau : {kwh(latest.grid_import_kwh)} soutirés, {kwh(latest.grid_export_kwh)} injectés.
          {latest.best_day ? (
            <>
              {" "}
              Meilleur jour : {new Date(latest.best_day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}{" "}
              ({kwh(latest.best_day_production_kwh)}).
            </>
          ) : null}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium text-muted">Production et consommation par semaine (kWh)</h2>
        <EnergyChart data={chartData} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Historique</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Semaine</th>
                <th className="px-4 py-2 text-right font-medium">Prod.</th>
                <th className="px-4 py-2 text-right font-medium">Conso.</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Autoconso.</th>
                <th className="px-4 py-2 text-right font-medium">Économies</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {reports.map((r) => (
                <tr key={r.start_date} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link href={`/semaine/${r.start_date}`} className="underline-offset-4 hover:underline">
                      {weekLabel(r.start_date, r.end_date)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">{kwh(r.production_kwh)}</td>
                  <td className="px-4 py-2 text-right">{kwh(r.consumption_kwh)}</td>
                  <td className="hidden px-4 py-2 text-right sm:table-cell">{pct(r.self_consumption_rate)}</td>
                  <td className="px-4 py-2 text-right">{eur(r.savings_total_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
      <h1 className="mb-2 font-semibold">{title}</h1>
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}
