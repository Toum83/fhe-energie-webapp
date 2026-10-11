import { Delta } from "@/components/Delta";
import { eur, num, shortWeekday } from "@/lib/format";
import { GAS, STOVE, type GasWeek, type StoveEffect } from "@/lib/gas";

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${iso}T12:00:00Z`));

/** Chauffage au gaz de la semaine : chaudière (chauffage seul) et plaques de cuisson. */
export function GasCard({ week, previous, stove, index }: { week: GasWeek; previous: GasWeek | null; stove: StoveEffect; index: number }) {
  const max = Math.max(...week.days.map((d) => d.gasKwh ?? 0), 0.001);
  return (
    <section className="card rise p-5" style={{ "--i": index } as React.CSSProperties}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Chauffage au gaz</h2>
        <span className="text-xs text-muted">Gazpar · GRDF</span>
      </div>

      {week.knownDays < 7 ? (
        <p className="mb-4 rounded-xl bg-[color-mix(in_oklab,#f5a524_16%,transparent)] px-3.5 py-2.5 text-xs leading-relaxed text-muted" role="note">
          GRDF publie le gaz avec 1 à 2 jours de retard :{" "}
          {week.lastKnownDay ? <>données jusqu&apos;au {dayLabel(week.lastKnownDay)}</> : <>pas encore de données pour cette semaine</>}{" "}
          ({week.knownDays} jour{week.knownDays > 1 ? "s" : ""} sur 7).
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="num text-[2rem] leading-none">
            {num(week.heatingKwh, 0)}
            <span className="ml-1 text-base font-semibold tracking-normal text-muted">kWh</span>
          </p>
          <p className="mt-1 text-xs text-muted">chauffage · {eur(week.heatingCostEur)}</p>
        </div>
        <div className="text-right">
          <p className="num text-[2rem] leading-none">{eur(week.costEur)}</p>
          <p className="mt-1 text-xs text-muted">gaz total ({num(week.gasKwh, 0)} kWh)</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat value={week.kwhPerDju == null ? "—" : `${num(week.kwhPerDju, 1)}`} label="kWh / DJU" hint={week.kwhPerDju != null && previous?.kwhPerDju != null ? <Delta current={week.kwhPerDju} previous={previous.kwhPerDju} goodWhen="down" suffix="" /> : null} />
        <Stat value={week.heatingHours == null ? "—" : `${num(week.heatingHours, 1)} h`} label="de chauffe" />
        <Stat value={`${num(week.cookingKwh, 1)}`} label="kWh cuisson" />
      </div>

      <ul className="mt-5 flex flex-col gap-2">
        {week.days.map((d) => (
          <li key={d.date} className="grid grid-cols-[3.75rem_1fr_auto] items-center gap-3">
            <span className="text-xs font-medium capitalize text-muted">
              {shortWeekday(d.date)}
              {d.stoveOn ? <span aria-label="poêle allumé" title="Poêle allumé"> 🔥</span> : null}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              {d.gasKwh != null ? (
                <div className="h-full rounded-full bg-conso" style={{ width: `${Math.max((d.gasKwh / max) * 100, d.gasKwh > 0 ? 2 : 0)}%` }} />
              ) : null}
            </div>
            <span className="num w-28 text-right text-xs tabular-nums text-muted">
              {d.gasKwh == null ? "à venir" : `${num(d.gasKwh, 1)} kWh`}
              {d.tempC != null ? ` · ${num(d.tempC, 0)} °C` : ""}
            </span>
          </li>
        ))}
      </ul>

      <StovePanel stove={stove} />

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Gazpar ne donne qu&apos;un total par jour : la cuisson est estimée à {num(GAS.cookingKwhPerDay, 2)} kWh/jour (conso
        d&apos;été), le reste est du chauffage. kWh/DJU = chauffage divisé par les degrés-jours (base {GAS.djuBaseC} °C,
        température GRDF) : il compare les semaines à météo égale. Prix {num(GAS.priceEurPerKwh, 3)} €/kWh.
      </p>
    </section>
  );
}

function Stat({ value, label, hint }: { value: string; label: string; hint?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
      <div className="num text-base">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      {hint ? <div className="mt-1 flex justify-center">{hint}</div> : null}
    </div>
  );
}

/** Effet du poêle sur la saison : kWh de chauffage par DJU, jours avec contre jours sans. */
function StovePanel({ stove }: { stove: StoveEffect }) {
  const { withStove, withoutStove, savingPct } = stove;
  return (
    <div className="mt-5 rounded-2xl bg-surface-2 px-4 py-3">
      <p className="text-sm font-semibold tracking-tight">🔥 Effet du poêle (depuis septembre)</p>
      {savingPct != null && withStove && withoutStove ? (
        <>
          <p className="mt-1 text-sm">
            {savingPct > 0 ? (
              <>
                La chaudière consomme <strong>{savingPct} % de moins</strong> les jours de poêle, à météo égale.
              </>
            ) : savingPct < 0 ? (
              <>
                Pas d&apos;économie visible : la chaudière consomme <strong>{-savingPct} % de plus</strong> les jours de poêle.
              </>
            ) : (
              <>Aucune différence visible les jours de poêle.</>
            )}
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted">
            avec poêle {num(withStove.kwhPerDju, 2)} kWh/DJU ({withStove.days} j) · sans {num(withoutStove.kwhPerDju, 2)} kWh/DJU (
            {withoutStove.days} j)
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Pas encore assez de jours froids pour comparer : il faut au moins {STOVE.minDaysPerGroup} jours avec poêle et{" "}
          {STOVE.minDaysPerGroup} jours sans (à plus de {STOVE.minDayDju} degrés-jours). Jusqu&apos;ici :{" "}
          {withStove?.days ?? "moins de " + STOVE.minDaysPerGroup} avec, {withoutStove?.days ?? "moins de " + STOVE.minDaysPerGroup} sans.
        </p>
      )}
    </div>
  );
}
