import type { BaseLoad } from "@/lib/nilm/baseload";
import type { Coverage } from "@/lib/nilm/coverage";
import type { DeviceWeek } from "@/lib/nilm/db";
import { groupDevices } from "@/lib/nilm/group";
import { withoutMeasured, type MeasuredDevice } from "@/lib/nilm/measured";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Bilan de la semaine par appareil nommé (étape 3 du module NILM). */
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(new Date(`${iso}T12:00:00Z`));

export function DeviceBreakdown({
  devices,
  weekConsumptionKwh,
  coverage,
  base,
  measured = [],
  index,
}: {
  devices: DeviceWeek[];
  /** Consommation des seuls jours couverts par la détection (le bilan complet si la semaine l'est). */
  weekConsumptionKwh: number;
  coverage: Coverage;
  /** Fond permanent sur les mêmes jours (null : pas encore mesuré). */
  base: BaseLoad | null;
  /** Appareils mesurés par une prise : remplacent l'estimation NILM de la même famille. */
  measured?: MeasuredDevice[];
  index: number;
}) {
  // Une prise qui couvre toute la période remplace les cartes NILM de l'appareil.
  const groups = withoutMeasured(groupDevices(devices), measured);
  const plugKwh = measured.reduce((a, m) => a + m.kwh, 0);
  const named = groups.reduce((a, d) => a + d.energy_kwh, 0) + plugKwh;
  const baseKwh = base ? Math.min(base.kwh, Math.max(weekConsumptionKwh - named, 0)) : 0;
  const rest = Math.max(weekConsumptionKwh - named - baseKwh, 0);
  const max = Math.max(...groups.map((d) => d.energy_kwh), ...measured.map((m) => m.kwh), baseKwh, rest, 0.001);
  const baseShare = weekConsumptionKwh ? Math.round((100 * baseKwh) / weekConsumptionKwh) : null;

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
        {groups.map((d, i) => {
          const kwh = d.energy_kwh;
          const share = weekConsumptionKwh ? Math.round((100 * kwh) / weekConsumptionKwh) : null;
          return (
            <li key={d.key}>
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
                {d.solar_share != null ? ` · ~${Math.round(d.solar_share * 100)} % couvert par le solaire` : ""}
              </p>
              {d.parts.length > 1 ? (
                <p className="mt-1 text-xs leading-relaxed text-faint">
                  dont {d.parts.map((p) => `${p.label} ${nf.format(p.energy_kwh)}`).join(" · ")} kWh
                </p>
              ) : null}
            </li>
          );
        })}
        {measured.map((m, i) => {
          const share = weekConsumptionKwh ? Math.round((100 * m.kwh) / weekConsumptionKwh) : null;
          return (
            <li key={m.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span aria-hidden>{m.icon}</span>
                  <span className="truncate">{m.label}</span>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">mesuré</span>
                </span>
                <span className="num shrink-0 text-base">{nf.format(m.kwh)} kWh</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="bar-x h-full rounded-full bg-conso"
                  style={{ "--i": groups.length + i, width: `${Math.max((m.kwh / max) * 100, m.kwh > 0 ? 3 : 0)}%` } as React.CSSProperties}
                />
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                prise connectée{m.complete ? "" : `, depuis le ${dayLabel(m.since)}`}
                {share != null ? ` · ${share} % de la conso ${coverage.partial ? "des jours couverts" : "de la semaine"}` : ""}
              </p>
            </li>
          );
        })}
        {base ? (
          <li>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span aria-hidden>🔋</span>
                <span className="truncate">Fond permanent</span>
              </span>
              <span className="num shrink-0 text-base">{nf.format(baseKwh)} kWh</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="bar-x h-full rounded-full bg-conso/60"
                style={{ "--i": groups.length + measured.length, width: `${(baseKwh / max) * 100}%` } as React.CSSProperties}
              />
            </div>
            <p className="mt-1.5 text-xs tabular-nums text-muted">
              ~{Math.round(base.watts)} W jour et nuit (veilles, frigo, box, VMC…)
              {baseShare != null ? ` · ${baseShare} % de la conso ${coverage.partial ? "des jours couverts" : "de la semaine"}` : ""}
            </p>
          </li>
        ) : null}
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
        les petits appareils et la pompe à chaleur du thermodynamique restent dans « Reste ». Le fond permanent est la
        puissance qui ne descend jamais, même la nuit. Les lignes « mesuré » viennent d'une prise connectée et
        remplacent l'estimation de l'appareil. Nommer un appareil dans
        Appareils complète aussi les semaines passées ; un nom « Famille · détail » (ex. « Cuisine · Bouilloire & four »)
        additionne les cartes de la même famille.
      </p>
    </section>
  );
}
