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
    <ol className="space-y-1.5 text-[13px] text-muted">
      {sources.map((s) => (
        <li key={s.id} id={`src-${s.id}`} className="flex gap-2">
          <span className="shrink-0 tabular-nums">[{s.id}]</span>
          <span>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-navy hover:underline"
            >
              {s.title}
            </a>
            <span className="ml-1.5 text-muted/70">{domainOf(s.url)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
