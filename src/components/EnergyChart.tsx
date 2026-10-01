"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type EnergyPoint = {
  label: string;
  production: number;
  consumption: number;
  selfConsumption?: number;
};

type Props = {
  data: EnergyPoint[];
  height?: number;
  /** Met en avant le dernier point (semaine / jour courant), estompe les autres. */
  highlightLast?: boolean;
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-2xl border border-border bg-surface/90 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-xl">
      <div className="mb-1.5 text-xs font-semibold text-muted">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 tabular-nums text-muted">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-semibold text-foreground">{nf.format(p.value)} kWh</span>
        </div>
      ))}
    </div>
  );
}

export function EnergyChart({ data, height = 240, highlightLast = false }: Props) {
  const last = data.length - 1;
  return (
    <div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart data={data} barCategoryGap="28%" barGap={3} margin={{ top: 8, right: 0, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="3 5" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={14}
              tickMargin={8}
              tick={{ fill: "var(--faint)", fontSize: 11 }}
            />
            <YAxis
              width={44}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--faint)", fontSize: 11 }}
              tickFormatter={(v: number) => nf.format(v)}
            />
            <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--grid)", radius: 8 }} />
            <Bar dataKey="production" name="Production" radius={[7, 7, 3, 3]} maxBarSize={22}>
              {data.map((_, i) => (
                <Cell key={i} fill="var(--series-prod)" fillOpacity={highlightLast && i !== last ? 0.45 : 1} />
              ))}
            </Bar>
            <Bar dataKey="consumption" name="Consommation" radius={[7, 7, 3, 3]} maxBarSize={22}>
              {data.map((_, i) => (
                <Cell key={i} fill="var(--series-conso)" fillOpacity={highlightLast && i !== last ? 0.45 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex items-center justify-center gap-5 text-xs font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-prod" />
          Production
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-conso" />
          Consommation
        </span>
      </div>
    </div>
  );
}
