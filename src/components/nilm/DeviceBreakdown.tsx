import type { Coverage } from "@/lib/nilm/coverage";
import type { DeviceWeek } from "@/lib/nilm/db";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Bilan de la semaine par appareil nommé (étape 3 du module NILM). */
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(`${iso}T12:00:00Z`));

export function DeviceBreakdown({
  devices,
  weekConsumptionKwh,
  coverage,
  index,
}: {
  devices: DeviceWeek[];
  /** Consommation des seuls jours couverts par la détection (le bilan complet si la semaine l'est). */
  weekConsumptionKwh: number;
  coverage: Coverage;
  index: number;
}) {
  const named = devices.reduce((a, d) => a + Number(d.energy_kwh), 0);
  const rest = Math.max(weekConsumptionKwh - named, 0);
  const max = Math.max(...devices.map((d) => Number(d.energy_kwh)), rest, 0.001);

  return (
    <section className="card rise p-5" style={{ "--i": index } as React.CSSProperties}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Par appareil</h2>
        <span className="text-xs text-muted">estimation</span>
      </div>
      {coverage.partial ? (
        <p className="mb-4 rounded-xl bg-[color-mix(in_oklab,#f5a524_16%,transparent)] px-3.5 py-2.5 text-xs leading-relaxed text-muted" role="note">
          <strong className="font-semibold text-foreground">Semaine partielle.</strong> La détection des appareils est
          active depuis le {dayLabel(coverage.dates[0])} : {coverage.coveredDays} jour{coverage.coveredDays > 1 ? "s" : ""} sur 7.
          Les kWh par appareil, les pourcentages et « Reste » ne portent que sur ces jours.
        </p>
      ) : null}
      <ul className="flex flex-col gap-4">
        {devices.map((d, i) => {
          const kwh = Number(d.energy_kwh);
          const share = weekConsumptionKwh ? Math.round((100 * kwh) / weekConsumptionKwh) : null;
          return (
            <li key={d.cluster_id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span aria-hidden>{d.icon ?? "🔌"}</span>
                  <span className="truncate">{d.label}</span>
                </span>
                <span className="num shrink-0 text-base">{nf.format(kwh)} kWh</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="bar-x h-full rounded-full bg-conso"
                  style={{ "--i": i, width: `${Math.max((kwh / max) * 100, kwh > 0 ? 3 : 0)}%` } as React.CSSProperties}
                />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                {d.sessions} utilisation{d.sessions > 1 ? "s" : ""}
                {share != null ? ` · ${share} % de la conso ${coverage.partial ? "des jours couverts" : "de la semaine"}` : ""}
                {d.solar_share != null ? ` · ~${Math.round(Number(d.solar_share) * 100)} % couvert par le solaire` : ""}
              </p>
            </li>
          );
        })}
        <li>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-muted">Reste (non attribué)</span>
            <span className="num text-base text-muted">{nf.format(rest)} kWh</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-faint/50" style={{ width: `${(rest / max) * 100}%` }} />
          </div>
        </li>
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        Estimations basses : seules les utilisations reconnues par leur signature sont comptées. Les appareils non nommés,
        les petits appareils et la pompe à chaleur du thermodynamique restent dans « Reste ». Nommer un appareil dans
        Appareils complète aussi les semaines passées.
      </p>
    </section>
  );
}
