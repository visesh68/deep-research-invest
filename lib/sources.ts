import type { Source } from "./schema";
import type { TavilyHit } from "./tavily";

// Exported for the dedup eval (evals/scorers.ts), which must normalize URLs the
// same way this module does or it would score a different dedup than the one that ran.
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    let pathname = u.pathname;
    if (pathname.endsWith("/") && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    return `${host}${pathname}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

// Groq's free tier caps requests at 8k tokens/minute including the completion,
// so the source block is bounded rather than passing through every hit.
const MAX_SOURCES = 18;
const SNIPPET_CHARS = 350;

export function mergeAndNumberSources(byAngle: Record<string, TavilyHit[]>): {
  sourcesBlock: string;
  sources: Source[];
} {
  const seen = new Map<string, TavilyHit>();

  for (const hits of Object.values(byAngle)) {
    for (const hit of hits) {
      if (!hit.url) continue;
      const key = normalizeUrl(hit.url);
      const existing = seen.get(key);
      if (!existing || existing.content.length < hit.content.length) {
        seen.set(key, hit);
      }
    }
  }

  const ordered = [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES);
  const sources: Source[] = ordered.map((h, i) => ({
    id: i + 1,
    title: h.title,
    url: h.url,
  }));
  const sourcesBlock = ordered
    .map(
      (h, i) =>
        `[${i + 1}] ${h.title} — ${h.url}` +
        // Undated sources stay unmarked rather than carrying a guessed date: the
        // absence is itself information the model can act on when dating a figure.
        (h.publishedDate ? ` (published ${h.publishedDate})` : "") +
        `\n${truncate(h.content, SNIPPET_CHARS)}`,
    )
    .join("\n\n");

  return { sourcesBlock, sources };
}
