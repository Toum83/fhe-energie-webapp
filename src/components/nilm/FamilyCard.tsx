import { ClusterCard, SessionList, type ClusterView, type SessionRow } from "./ClusterCard";

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Une famille d'appareils (« Lave-linge · chauffe », « Lave-linge · lavage »…) affichée comme un
 * seul appareil : les régimes sont des cartes distinctes pour le NILM, mais un seul appareil pour
 * l'utilisateur. Chaque régime reste renommable dans le détail replié.
 */
export function FamilyCard({
  name,
  members,
  sessionsById,
  index,
}: {
  name: string;
  members: ClusterView[];
  sessionsById: Map<number | null, SessionRow[]>;
  index: number;
}) {
  const occurrences = members.reduce((a, c) => a + c.occurrences, 0);
  const hourly = Array.from({ length: 24 }, (_, h) => members.reduce((a, c) => a + (c.hourly[h] ?? 0), 0));
  const maxHour = Math.max(...hourly, 1);
  const powers = members.map((c) => c.centroid_power_w);
  const sessions = members
    .flatMap((c) => sessionsById.get(c.id) ?? [])
    .sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0))
    .slice(0, 10);
  const icon = members.find((c) => c.icon)?.icon ?? "❔";

  return (
    <article className="card rise p-5" style={{ "--i": index } as React.CSSProperties}>
      <header className="flex items-start gap-3">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-xl">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold tracking-tight">{name}</h3>
          <p className="text-xs text-muted">
            {members.length} régimes · n°{members.map((c) => c.id).join(", ")}
          </p>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
          <div className="num text-base">
            {nf.format(Math.min(...powers))}–{nf.format(Math.max(...powers))} W
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">puissances</div>
        </div>
        <div className="rounded-2xl bg-surface-2 px-2 py-2.5">
          <div className="num text-base">{occurrences}×</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">détecté</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex h-14 items-end gap-[3px]" role="img" aria-label="Répartition par heure de la journée">
          {hourly.map((n, h) => (
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
      </div>

      {sessions.length > 0 ? <SessionList sessions={sessions} /> : null}

      <details className="group/regimes mt-4">
        <summary className="cursor-pointer list-none text-xs font-semibold text-muted">
          <span className="inline-block transition-transform group-open/regimes:rotate-90">›</span> Régimes ({members.length})
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {members.map((c, i) => (
            <ClusterCard key={c.id} cluster={c} index={i} sessions={sessionsById.get(c.id) ?? []} />
          ))}
        </div>
      </details>
    </article>
  );
}
