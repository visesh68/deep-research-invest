export type TavilyHit = {
  title: string;
  url: string;
  content: string;
  score: number;
};

const TAVILY_URL = "https://api.tavily.com/search";

export async function searchAngle(query: string): Promise<TavilyHit[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      // Equity data goes stale fast; without this the model happily cites
      // two-year-old quarterly figures as current.
      time_range: "year",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];
  return results.map((r: { title?: string; url?: string; content?: string; score?: number }) => ({
    title: r.title ?? "Untitled",
    url: r.url ?? "",
    content: r.content ?? "",
    score: typeof r.score === "number" ? r.score : 0,
  }));
}

export type AngleSearchLog = {
  angleId: string;
  query: string;
  ms: number;
  results: TavilyHit[];
};

export async function runAllAngles(
  angles: { id: string; query: string }[],
): Promise<{ byAngle: Record<string, TavilyHit[]>; log: AngleSearchLog[] }> {
  const log: AngleSearchLog[] = await Promise.all(
    angles.map(async (a) => {
      const started = Date.now();
      const results = await searchAngle(a.query);
      return { angleId: a.id, query: a.query, ms: Date.now() - started, results };
    }),
  );

  const byAngle: Record<string, TavilyHit[]> = {};
  for (const entry of log) {
    byAngle[entry.angleId] = entry.results;
  }
  return { byAngle, log };
}
