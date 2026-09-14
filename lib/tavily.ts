import { createLruCache } from "./cache";

export type TavilyHit = {
  title: string;
  url: string;
  content: string;
  score: number;
  // Only present on news-topic searches; Tavily omits the field entirely on the
  // default topic. Undated hits are normal and render without a date suffix.
  publishedDate?: string;
};

export type SearchOptions = {
  topic?: "general" | "news";
  timeRange?: "day" | "week" | "month" | "year";
};

const TAVILY_URL = "https://api.tavily.com/search";

/**
 * Spot prices go stale in days; fundamentals do not.
 *
 * A single `time_range: "year"` across every angle let a seven-month-old price
 * article rank top on relevance and reach synthesis undated, which is how a
 * February SMA shipped inside a September note as current momentum. Price angles
 * therefore get a week-wide news search, and only news searches carry
 * `published_date` at all — on the default topic Tavily omits the field, so the
 * model has no way to date a quote it is shown.
 *
 * Non-price angles keep the original year-wide default topic: news search trades
 * away the filings, IR pages and profile sites that fundamentals angles depend on,
 * and those angles already label their figures by quarter from the prose itself.
 *
 * Classified in code rather than asked of the planner: the plan's angle `id` is a
 * free-form string the model picks, and prompt conventions drift between model
 * versions where a regex does not.
 */
const PRICE_ANGLE_RE =
  /\b(share price|stock price|price target|market cap|valuation snapshot|quote|trading at|SMA|moving average|52[- ]week)\b/i;

export function searchOptionsFor(query: string): SearchOptions {
  return PRICE_ANGLE_RE.test(query)
    ? { topic: "news", timeRange: "week" }
    : { timeRange: "year" };
}

// Tavily returns RFC-1123 ("Tue, 10 Feb 2026 16:56:14 GMT"). The clock time is
// noise in a sources block that is already trimmed for tokens, and an ISO date
// sorts and reads unambiguously.
function normalizeDate(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

// One slow angle must not hold the whole run open to the 300s function ceiling.
const PER_ANGLE_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;
// The plan schema guarantees 3-6 angles. Below two surviving angles there is not
// enough breadth for a defensible thesis, so the run fails loudly instead of
// producing a confident-looking note built on one search.
const MIN_SUCCESSFUL_ANGLES = 2;

// Angle queries repeat far more than whole questions do: two different questions
// about the same company produce overlapping angles, and a repeated question
// produces near-identical ones. Tavily credits (~12 per run on advanced depth)
// are the scarcer resource here, so this layer earns more than the response cache.
const angleCache = createLruCache<TavilyHit[]>({ max: 200, ttlMs: 60 * 60 * 1000 });

export function angleCacheStats() {
  return angleCache.stats();
}

export class TavilyHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export class ResearchFanoutError extends Error {
  // The per-angle log rides out with the error. A hard fan-out failure is exactly
  // when the individual angle diagnostics matter most, and they would otherwise be
  // dropped at the throw — leaving a trace that shows a research stage with no
  // searches in it.
  constructor(
    message: string,
    public log: AngleSearchLog[] = [],
    public failures: FanoutResult["failures"] = [],
  ) {
    super(message);
  }
}

export async function searchAngle(
  query: string,
  signal?: AbortSignal,
  opts: SearchOptions = { timeRange: "year" },
): Promise<TavilyHit[]> {
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
      // two-year-old quarterly figures as current. Price angles narrow it
      // further — see searchOptionsFor.
      time_range: opts.timeRange ?? "year",
      ...(opts.topic ? { topic: opts.topic } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TavilyHttpError(
      `Tavily API error ${res.status}: ${text.slice(0, 500)}`,
      res.status,
    );
  }

  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];
  return results.map(
    (r: {
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      published_date?: string;
    }) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      content: r.content ?? "",
      score: typeof r.score === "number" ? r.score : 0,
      publishedDate: normalizeDate(r.published_date),
    }),
  );
}

// A missing key or a malformed request will fail identically on every retry;
// only rate limits, upstream faults and transport errors are worth a second try.
function isRetryable(err: unknown): boolean {
  if (err instanceof TavilyHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error && err.message.includes("TAVILY_API_KEY")) {
    return false;
  }
  return true;
}

async function searchAngleWithRetry(
  query: string,
  opts: SearchOptions,
): Promise<{ results: TavilyHit[]; attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = await searchAngle(query, AbortSignal.timeout(PER_ANGLE_TIMEOUT_MS), opts);
      return { results, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isRetryable(err)) break;
      // Jittered backoff so six concurrent angles hitting a 429 do not all
      // retry in the same instant and trip the limit again.
      await new Promise((r) => setTimeout(r, 400 * attempt + Math.random() * 300));
    }
  }
  throw lastErr;
}

export type AngleSearchLog = {
  angleId: string;
  query: string;
  startedAt: string;
  ms: number;
  results: TavilyHit[];
  attempts: number;
  cached?: boolean;
  error?: string;
};

export type FanoutResult = {
  byAngle: Record<string, TavilyHit[]>;
  log: AngleSearchLog[];
  failures: { angleId: string; query: string; error: string }[];
};

/**
 * Runs every angle concurrently and tolerates partial failure.
 *
 * `Promise.allSettled` rather than `Promise.all`: a single dead angle used to
 * abort a run that five healthy angles could have carried, after the planning
 * call had already been paid for. The run now degrades instead of failing, and
 * only gives up below MIN_SUCCESSFUL_ANGLES.
 */
export async function runAllAngles(
  angles: { id: string; query: string }[],
): Promise<FanoutResult> {
  const settled = await Promise.allSettled(
    angles.map(async (a) => {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      const opts = searchOptionsFor(a.query);
      // The options are part of the identity of a search: the same query run
      // week-wide over news and year-wide over the general topic returns
      // different hits, so keying on the query alone would serve one under the
      // other's key for an hour.
      const cacheKey = `${a.query}|${opts.topic ?? "general"}|${opts.timeRange ?? "year"}`;
      const cached = angleCache.get(cacheKey);
      if (cached) {
        return {
          angleId: a.id,
          query: a.query,
          startedAt,
          ms: Date.now() - started,
          results: cached.value,
          attempts: 0,
          cached: true,
        };
      }
      try {
        const { results, attempts } = await searchAngleWithRetry(a.query, opts);
        // Only successful searches are cached; a failure must be retried next run,
        // never memoized into an hour of empty results.
        if (results.length > 0) angleCache.set(cacheKey, results);
        return { angleId: a.id, query: a.query, startedAt, ms: Date.now() - started, results, attempts };
      } catch (err) {
        throw Object.assign(err as Error, { angleId: a.id, startedAt, ms: Date.now() - started });
      }
    }),
  );

  const log: AngleSearchLog[] = [];
  const failures: FanoutResult["failures"] = [];
  const byAngle: Record<string, TavilyHit[]> = {};

  settled.forEach((outcome, i) => {
    const angle = angles[i];
    if (outcome.status === "fulfilled") {
      log.push(outcome.value);
      byAngle[outcome.value.angleId] = outcome.value.results;
      return;
    }
    const err = outcome.reason as Error & { ms?: number; startedAt?: string };
    const message = err?.message ?? String(outcome.reason);
    log.push({
      angleId: angle.id,
      query: angle.query,
      startedAt: err?.startedAt ?? new Date().toISOString(),
      ms: err?.ms ?? 0,
      results: [],
      attempts: MAX_ATTEMPTS,
      error: message,
    });
    failures.push({ angleId: angle.id, query: angle.query, error: message });
  });

  const succeeded = angles.length - failures.length;
  if (succeeded < Math.min(MIN_SUCCESSFUL_ANGLES, angles.length)) {
    throw new ResearchFanoutError(
      `Only ${succeeded} of ${angles.length} research angles succeeded. ` +
        `First failure: ${failures[0]?.error ?? "unknown"}`,
      log,
      failures,
    );
  }

  return { byAngle, log, failures };
}
