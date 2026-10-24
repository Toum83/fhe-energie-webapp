/** Synthèse de la semaine rédigée par Claude (lib/summary/generate.ts). */
export function SummaryCard({ text, index }: { text: string; index: number }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="card rise p-5" style={{ "--i": index } as React.CSSProperties}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">La semaine en bref</h2>
        <span className="text-xs text-muted">rédigé par Claude</span>
      </div>
      <div className="flex flex-col gap-2.5 text-sm leading-relaxed">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </section>
  );
}
