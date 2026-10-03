"use client";

import { useState } from "react";

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-2xl bg-surface-2 p-4 pr-24 text-[12px] leading-relaxed">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
        className="press absolute right-3 top-3 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}
