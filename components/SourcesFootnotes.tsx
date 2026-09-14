import type { Source } from "@/lib/schema";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function SourcesFootnotes({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  return (
    <ol className="grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
      {sources.map((s, i) => (
        <li
          key={s.id}
          id={`src-${s.id}`}
          className="reveal group flex gap-2.5 scroll-mt-24 leading-snug"
          style={{ "--i": i + 1 } as React.CSSProperties}
        >
          <span className="nums mt-px shrink-0 text-[11px] font-medium text-muted-2 tabular-nums">
            {String(s.id).padStart(2, "0")}
          </span>
          <span className="min-w-0">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="link-underline text-ink-2 transition-colors duration-150 group-hover:text-accent"
            >
              {s.title}
            </a>
            <span className="mt-0.5 block text-[11px] text-muted-2">{domainOf(s.url)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
