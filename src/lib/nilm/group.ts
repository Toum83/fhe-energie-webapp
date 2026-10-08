import type { DeviceWeek } from "./db";

/**
 * Familles d'appareils pour le bilan : un nom « Cuisine · Bouilloire & four » range la carte
 * dans la famille « Cuisine ». À 5 min de résolution, plusieurs cartes ne sont que des régimes
 * différents des mêmes appareils (four, bouilloire, lave-vaisselle ont la même signature) :
 * leur somme est fiable, le détail beaucoup moins. Les capteurs HA restent par carte.
 */
export type DeviceGroup = {
  key: string;
  label: string;
  icon: string | null;
  energy_kwh: number;
  sessions: number;
  solar_share: number | null;
  /** Cartes regroupées (vide pour une carte seule). */
  parts: { label: string; energy_kwh: number }[];
};

const SEP = /\s+[·:]\s+/;

export function splitFamily(label: string): { family: string | null; detail: string } {
  const m = SEP.exec(label);
  if (!m || m.index === 0) return { family: null, detail: label.trim() };
  return { family: label.slice(0, m.index).trim(), detail: label.slice(m.index + m[0].length).trim() };
}

export function groupDevices(devices: DeviceWeek[]): DeviceGroup[] {
  const groups = new Map<string, DeviceWeek[]>();
  for (const d of devices) {
    const { family } = splitFamily(d.label);
    const key = family ? `f:${family.toLocaleLowerCase("fr")}` : `c:${d.cluster_id}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const out: DeviceGroup[] = [];
  for (const [key, members] of groups) {
    const sorted = [...members].sort((a, b) => Number(b.energy_kwh) - Number(a.energy_kwh));
    const energy = sorted.reduce((a, d) => a + Number(d.energy_kwh), 0);
    const solarW = sorted.reduce((a, d) => a + (d.solar_share == null ? 0 : Number(d.solar_share) * Number(d.energy_kwh)), 0);
    const solarKnown = sorted.some((d) => d.solar_share != null);
    const single = !key.startsWith("f:");
    out.push({
      key,
      label: single ? sorted[0].label : splitFamily(sorted[0].label).family!,
      icon: sorted[0].icon,
      energy_kwh: Math.round(energy * 100) / 100,
      sessions: sorted.reduce((a, d) => a + d.sessions, 0),
      solar_share: solarKnown && energy > 0 ? Math.round((solarW / energy) * 100) / 100 : null,
      parts: single ? [] : sorted.map((d) => ({ label: splitFamily(d.label).detail, energy_kwh: Number(d.energy_kwh) })),
    });
  }
  return out.sort((a, b) => b.energy_kwh - a.energy_kwh);
}
