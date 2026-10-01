import { num, weekdayInitial } from "@/lib/format";
import type { DayStat } from "@/lib/types";

type Props = {
  days: DayStat[];
  /** Couleur des barres, ex. "#fff" sur fond coloré. */
  color?: string;
  muted?: string;
  height?: number;
  metric?: "production_kwh" | "consumption_kwh";
};

/** 7 mini-barres (une par jour) avec le meilleur jour mis en avant. */
export function DayBars({ days, color = "var(--series-prod)", muted, height = 76, metric = "production_kwh" }: Props) {
  const max = Math.max(...days.map((d) => d[metric]), 0.001);
  const best = days.reduce((a, d) => (d[metric] > a[metric] ? d : a), days[0]);
  return (
    <div className="grid grid-cols-7 gap-2" role="img" aria-label="Valeur par jour de la semaine">
      {days.map((d, i) => {
        const h = Math.max((d[metric] / max) * height, d[metric] > 0 ? 4 : 2);
        const isBest = d.date === best.date && d[metric] > 0;
        return (
          <div key={d.date} className="flex flex-col items-center gap-1.5">
            <span className={`num text-[10px] ${isBest ? "opacity-100" : "opacity-0"}`}>{num(d[metric])}</span>
            <div className="flex items-end" style={{ height }}>
              <div
                className="bar-y w-full min-w-5 rounded-full"
                style={
                  {
                    "--i": i,
                    height: h,
                    width: 22,
                    background: color,
                    opacity: isBest ? 1 : 0.5,
                    ...(muted && !isBest ? { background: muted, opacity: 1 } : null),
                  } as React.CSSProperties
                }
              />
            </div>
            <span className={`text-[11px] font-semibold ${isBest ? "" : "opacity-60"}`}>{weekdayInitial(d.date)}</span>
          </div>
        );
      })}
    </div>
  );
}
