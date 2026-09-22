"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type EnergyPoint = {
  label: string;
  production: number;
  consumption: number;
  selfConsumption?: number;
};

type Props = {
  data: EnergyPoint[];
  height?: number;
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
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 tabular-nums text-muted">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto text-foreground">{nf.format(p.value)} kWh</span>
        </div>
      ))}
    </div>
  );
}

export function EnergyChart({ data, height = 260 }: Props) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} barCategoryGap="30%" barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <YAxis
            width={40}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(v: number) => nf.format(v)}
          />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--grid)", opacity: 0.5 }} />
          <Legend
            iconType="circle"
            iconSize={8}
            itemSorter={() => 0}
            wrapperStyle={{ fontSize: 12, color: "var(--muted)", paddingTop: 8 }}
          />
          <Bar
            dataKey="production"
            name="Production"
            fill="var(--series-prod)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="consumption"
            name="Consommation"
            fill="var(--series-conso)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
