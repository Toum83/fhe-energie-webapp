import { headers } from "next/headers";
import { CopyBlock } from "@/components/nilm/CopyBlock";
import { RunButton } from "@/components/nilm/RunButton";
import { ClusterCard, SessionList, type ClusterView, type SessionRow } from "@/components/nilm/ClusterCard";
import { FamilyCard } from "@/components/nilm/FamilyCard";
import { adminConfigured, isAdmin } from "@/lib/nilm/auth";
import { dbConfigured, fetchClusters, fetchRecentSessions, type RecentSession, type StoredCluster } from "@/lib/nilm/db";
import { splitFamily } from "@/lib/nilm/group";
import { haRestYaml } from "@/lib/nilm/ha";
import { toIdentifyNow } from "@/lib/nilm/identify";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appareils · Bilan énergie", robots: { index: false, follow: false } };

export default async function AppareilsPage({ searchParams }: PageProps<"/appareils">) {
  const { erreur } = await searchParams;

  if (!adminConfigured() || !dbConfigured()) {
    return (
      <Notice title="Module non configuré">
        Il manque des variables d&apos;environnement côté serveur (Vercel) : <code>NILM_ADMIN_TOKEN</code> et{" "}
        <code>FHE_WRITE_TOKEN</code> (le même jeton que <code>fhe_energy_write_token</code> dans HA). Voir le README.
      </Notice>
    );
  }

  if (!(await isAdmin())) {
    return (
      <section className="card rise mx-auto max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">Espace privé</h1>
        <p className="mt-1 text-sm text-muted">
          Cette page affiche les heures d&apos;activité des appareils de la maison : elle est protégée par un jeton.
        </p>
        <form action="/api/nilm/login" method="post" className="mt-4 flex flex-col gap-3">
          <input
            type="password"
            name="token"
            required
            autoComplete="current-password"
            placeholder="Jeton d'accès"
            aria-label="Jeton d'accès"
            className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-base outline-none focus:border-foreground/40"
          />
          {erreur ? <p className="text-xs text-[#e5484d]">Jeton incorrect.</p> : null}
          <button type="submit" className="press rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background">
            Entrer
          </button>
        </form>
      </section>
    );
  }

  let clusters: StoredCluster[] = [];
  let loadError: string | null = null;
  try {
    clusters = await fetchClusters();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Erreur de lecture";
  }
  const named = clusters.filter((c) => c.label).length;

  // Facultatif : si la fonction SQL n'est pas encore installée, les cartes s'affichent sans la liste.
  let recent: RecentSession[] = [];
  try {
    recent = await fetchRecentSessions(8);
  } catch {
    recent = [];
  }
  const byCluster = new Map<number | null, SessionRow[]>();
  for (const r of recent) {
    const rows = byCluster.get(r.cluster_id) ?? [];
    rows.push(toRow(r));
    byCluster.set(r.cluster_id, rows);
  }
  const isolated = byCluster.get(null) ?? [];
  const toName = toIdentifyNow(recent, new Set(clusters.filter((c) => c.label).map((c) => c.id)));

  return (
    <div className="flex flex-col gap-4">
      <section className="rise px-1" style={{ "--i": 0 } as React.CSSProperties}>
        <p className="eyebrow">Désagrégation de la consommation</p>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Appareils</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Les gros consommateurs sont reconnus par leur signature (puissance et durée de fonctionnement), pas par l&apos;heure.
          Nommez-les pour que le bilan puisse dire ce qu&apos;ils consomment. Les petits appareils (veilles, grille-pain) et la
          pompe à chaleur, qui module sa puissance, restent peu visibles à cette résolution.
        </p>
      </section>

      <section className="card rise flex flex-wrap items-center justify-between gap-4 p-5" style={{ "--i": 1 } as React.CSSProperties}>
        <div>
          <p className="num text-2xl">{clusters.length}</p>
          <p className="text-xs text-muted">
            appareil{clusters.length > 1 ? "s" : ""} détecté{clusters.length > 1 ? "s" : ""} · {named} nommé{named > 1 ? "s" : ""}
          </p>
        </div>
        <RunButton />
      </section>

      {loadError ? <Notice title="Lecture impossible">{loadError}</Notice> : null}

      {toName.length > 0 ? (
        <section className="card rise p-5" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 className="text-base font-semibold tracking-tight">C&apos;était quoi ?</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Appareils pas encore nommés qui ont tourné ces 48 dernières heures. Si vous savez ce qui marchait à ce
            moment-là, nommez sa carte : toutes ses sessions, passées et à venir, seront comptées sous ce nom.
          </p>
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {toName.map((s) => {
              const row = toRow(s);
              return (
                <li key={row.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">
                      {row.day} · {row.start} → {row.end}
                    </span>
                    <span className="block text-xs text-muted">
                      {nf.format(row.power_w)} W · {durationText(row.duration_min)} · appareil n°{s.cluster_id}
                    </span>
                  </span>
                  <a href={`#carte-${s.cluster_id}`} className="shrink-0 text-xs font-medium underline underline-offset-2 hover:text-muted">
                    Nommer →
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {clusters.length === 0 && !loadError ? (
        <Notice title="Aucun appareil pour l'instant">
          Lancez le regroupement : il faut quelques jours d&apos;événements pour que des signatures récurrentes apparaissent.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-4">
        {byFamily(clusters).map((entry, i) =>
          entry.members.length > 1 ? (
            <FamilyCard key={entry.key} name={entry.name} members={entry.members} sessionsById={byCluster} index={i + 2} />
          ) : (
            <ClusterCard key={entry.key} index={i + 2} cluster={entry.members[0]} sessions={byCluster.get(entry.members[0].id) ?? []} />
          ),
        )}
      </div>

      {isolated.length > 0 ? (
        <section className="card rise p-5">
          <h2 className="text-base font-semibold tracking-tight">Sessions isolées</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Marche/arrêt reconstitués mais rattachés à aucun appareil (signature trop rare pour l&apos;instant).
          </p>
          <SessionList sessions={isolated} title="Les plus récentes" />
        </section>
      ) : null}

      {named > 0 ? <HaSetup clusters={clusters} host={(await headers()).get("host")} /> : null}

      <form action="/api/nilm/logout" method="post" className="px-1 pt-2">
        <button type="submit" className="text-xs text-faint underline-offset-4 hover:underline">
          Se déconnecter
        </button>
      </form>
    </div>
  );
}

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function toView(c: StoredCluster): ClusterView {
  return {
    id: c.id,
    label: c.label,
    icon: c.icon,
    centroid_power_w: Number(c.centroid_power_w),
    avg_duration_min: Number(c.avg_duration_min),
    occurrences: c.occurrences,
    avg_pct_solar: c.avg_pct_solar == null ? null : Number(c.avg_pct_solar),
    hourly: c.hourly,
    last_seen: c.last_seen,
  };
}

/** Cartes nommées « Famille · régime » réunies en un appareil, à la place de la première d'entre elles. */
function byFamily(clusters: StoredCluster[]) {
  const out: { key: string; name: string; members: ClusterView[] }[] = [];
  const families = new Map<string, (typeof out)[number]>();
  for (const c of clusters) {
    const family = c.label ? splitFamily(c.label).family : null;
    if (!family) {
      out.push({ key: `c${c.id}`, name: c.label ?? "", members: [toView(c)] });
      continue;
    }
    const k = family.toLocaleLowerCase("fr");
    const entry = families.get(k);
    if (entry) entry.members.push(toView(c));
    else {
      const e = { key: `f${k}`, name: family, members: [toView(c)] };
      families.set(k, e);
      out.push(e);
    }
  }
  return out;
}

function durationText(min: number) {
  if (min < 60) return `${nf.format(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

function toRow(r: RecentSession): SessionRow {
  const start = new Date(r.start_ts);
  return {
    key: `${r.cluster_id ?? "x"}-${r.start_ts}`,
    day: dayFmt.format(start),
    start: timeFmt.format(start),
    end: timeFmt.format(new Date(r.end_ts)),
    power_w: Number(r.power_w),
    duration_min: Number(r.duration_min),
    sortKey: start.getTime(),
  };
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card rise p-6">
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function HaSetup({ clusters, host }: { clusters: StoredCluster[]; host: string | null }) {
  const devices = clusters
    .filter((c) => c.label && c.label.trim())
    .map((c) => ({ cluster_id: c.id, label: c.label!.trim() }));
  const url = `https://${host ?? "votre-app.vercel.app"}/api/nilm/devices`;
  return (
    <section className="card rise p-5">
      <h2 className="text-base font-semibold tracking-tight">Capteurs dans Home Assistant</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Un capteur d&apos;énergie par appareil nommé, mis à jour toutes les 15 minutes, utilisable dans le tableau de bord
        Énergie (appareils individuels). À refaire quand vous nommez un nouvel appareil ; renommer ne change rien.
      </p>
      <ol className="mt-4 flex list-decimal flex-col gap-3 pl-5 text-sm text-muted">
        <li>
          Dans <code>secrets.yaml</code> de HA, ajoutez (le jeton est celui de cette page) :
          <div className="mt-2">
            <CopyBlock
              label="Copier les secrets"
              text={`nilm_devices_url: ${url}\nnilm_admin_bearer: "Bearer VOTRE_NILM_ADMIN_TOKEN"`}
            />
          </div>
        </li>
        <li>
          Collez ce bloc à la fin du package <code>packages/fhe_energy.yaml</code> (ou remplacez l&apos;ancien bloc
          <code> rest:</code> s&apos;il existe), puis redémarrez Home Assistant :
          <div className="mt-2">
            <CopyBlock label="Copier le YAML" text={haRestYaml(devices)} />
          </div>
        </li>
      </ol>
    </section>
  );
}
