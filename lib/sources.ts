import type { Source } from "./schema";
import type { TavilyHit } from "./tavily";

function normalizeUrl(url: string): string {
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

  const ordered = [...seen.values()].sort((a, b) => b.score - a.score);
  const sources: Source[] = ordered.map((h, i) => ({
    id: i + 1,
    title: h.title,
    url: h.url,
  }));
  const sourcesBlock = ordered
    .map((h, i) => `[${i + 1}] ${h.title} — ${h.url}\n${truncate(h.content, 500)}`)
    .join("\n\n");

  return { sourcesBlock, sources };
}
