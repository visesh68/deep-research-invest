/**
 * Deterministic scorers over a finished RunTranscript.
 *
 * Every scorer here checks a property the pipeline actually promises somewhere —
 * a prompt rule, a schema constraint, or a retrieval decision — so a regression
 * in a prompt or a model swap shows up as a number rather than as a reader
 * noticing a bad note. Nothing here calls a model: these run over the committed
 * transcripts in ~a second and are safe in CI. The model-graded checks that need
 * judgement live in judge.ts.
 */
import type { RunTranscript } from "../lib/transcript.ts";
import { ResearchPlanSchema, ThesisSchema, type Thesis } from "../lib/schema.ts";
import { normalizeUrl } from "../lib/sources.ts";
import { searchOptionsFor } from "../lib/tavily.ts";
import type { EvalCase } from "./cases.ts";

export type Stage = "plan" | "retrieval" | "synthesis";

export type ScoreResult = {
  /** 0..1, or null when the scorer does not apply to this run. */
  score: number | null;
  /** One line summarising what was measured, e.g. "5/6 angles clean". */
  detail: string;
  /** Specific offending items, quoted, for the failure report. */
  failures: string[];
};

export type Scorer = {
  id: string;
  stage: Stage;
  /** What a low score means. Printed in the report legend. */
  describes: string;
  /**
   * Suite-wide minimum. The mean across all applicable runs must meet this or
   * the eval run exits non-zero.
   */
  threshold: number;
  run: (t: RunTranscript, kase?: EvalCase) => ScoreResult;
};

// ---------------------------------------------------------------- helpers

const NA: ScoreResult = { score: null, detail: "not applicable", failures: [] };

function ratio(passed: number, total: number, unit: string, failures: string[]): ScoreResult {
  if (total === 0) return NA;
  return { score: passed / total, detail: `${passed}/${total} ${unit}`, failures };
}

function bool(ok: boolean, detail: string, failures: string[] = []): ScoreResult {
  return { score: ok ? 1 : 0, detail, failures };
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentences(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean).length;
}

type Bullet = { id: string; text: string; sourceIds: number[] };

/**
 * Reads priceContext in either shape.
 *
 * It shipped as a bare string before it was brought into the citation system,
 * and the committed transcripts still hold both forms. Scorers run over history,
 * so they must read history — normalizing here rather than in each scorer.
 */
export function priceContextOf(thesis: Thesis): { text: string; sourceIds: number[] } {
  const pc = thesis.priceContext as unknown;
  if (typeof pc === "string") return { text: pc, sourceIds: [] };
  if (pc && typeof pc === "object" && typeof (pc as { text?: unknown }).text === "string") {
    const o = pc as { text: string; sourceIds?: number[] };
    return { text: o.text, sourceIds: o.sourceIds ?? [] };
  }
  return { text: "", sourceIds: [] };
}

/** Every cited claim in a thesis, flattened with a field-qualified id. */
export function citedBullets(thesis: Thesis): Bullet[] {
  const out: Bullet[] = [];
  for (const field of ["bullCase", "bearCase", "catalysts", "risks"] as const) {
    // Legacy transcripts are scored too, so nothing here assumes a field exists.
    (thesis[field] ?? []).forEach((b, i) => {
      out.push({ id: `${field}[${i}]`, text: b?.text ?? "", sourceIds: b?.sourceIds ?? [] });
    });
  }
  const pc = priceContextOf(thesis);
  out.push({ id: "priceContext", text: pc.text, sourceIds: pc.sourceIds });
  return out;
}

/** Free-text fields that must never contain an inline citation marker. */
function narrativeFields(thesis: Thesis): { id: string; text: string }[] {
  return [
    { id: "summary", text: thesis.summary },
    { id: "valuationSummary", text: thesis.valuationSummary },
    ...citedBullets(thesis).map((b) => ({ id: b.id, text: b.text })),
  ];
}

export type ParsedSource = { id: number; title: string; url: string; published?: string; snippet: string };

/**
 * Re-reads the numbered sources block out of the synthesis prompt.
 *
 * Deliberately parsed from the prompt rather than rebuilt from the Tavily log:
 * the block is exactly what the model was shown, truncated to 350 chars and all.
 * Grounding a claim against text the model never saw would score the wrong thing.
 */
export function parseSourcesBlock(userPrompt: string): Map<number, ParsedSource> {
  const out = new Map<number, ParsedSource>();
  const body = userPrompt.split(/^SOURCES:$/m)[1];
  if (!body) return out;

  // Split on the "[n] Title — url" headers rather than on blank lines: a Tavily
  // snippet routinely contains blank lines of its own, and splitting on those
  // silently drops everything after a source's first paragraph — which would
  // mark correctly-sourced figures as ungrounded.
  const header = /^\[(\d+)\]\s+(.*?)\s+—\s+(\S+)(?:\s+\(published (\d{4}-\d{2}-\d{2})\))?$/gm;
  const heads: { id: number; title: string; url: string; published?: string; start: number; end: number }[] = [];
  for (let m = header.exec(body); m; m = header.exec(body)) {
    heads.push({
      id: Number(m[1]),
      title: m[2],
      url: m[3],
      published: m[4],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  heads.forEach((h, i) => {
    const snippet = body.slice(h.end, heads[i + 1]?.start ?? body.length).trim();
    out.set(h.id, { id: h.id, title: h.title, url: h.url, published: h.published, snippet });
  });
  return out;
}

// "$1,234.5" / "46.4%" / "1.2" — the figure, stripped of its decoration.
const NUMBER_RE = /-?\$?\d[\d,]*(?:\.\d+)?%?/g;

function numericTokens(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/[$,%]/g, "").replace(/\.$/, ""));
}

function decimalPlaces(token: string): number {
  const dot = token.indexOf(".");
  return dot === -1 ? 0 : token.length - dot - 1;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * A figure counts as traceable if the source carries the same number, or one the
 * note rounded (46.4 against 46.43). Rounding is a paraphrase; inventing a digit
 * is not.
 *
 * Matched numerically rather than by string prefix. Prefix matching let "~33%
 * upside" pass against a snippet whose only "3" came from "Q3 fiscal 2026" —
 * the source actually said 12.13%.
 */
function numberIsTraceable(value: string, sourceNumbers: Set<string>): boolean {
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  const vPlaces = decimalPlaces(value);
  for (const token of sourceNumbers) {
    const n = Number(token);
    if (!Number.isFinite(n)) continue;
    if (n === v) return true;
    const nPlaces = decimalPlaces(token);
    if (vPlaces < nPlaces && roundTo(n, vPlaces) === v) return true;
    if (nPlaces < vPlaces && roundTo(v, nPlaces) === n) return true;
  }
  return false;
}

const CURRENCY_ALIASES: Record<string, string> = {
  $: "USD", "US$": "USD", USD: "USD", "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP",
  "¥": "JPY", JPY: "JPY", CHF: "CHF", CAD: "CAD", AUD: "AUD", SEK: "SEK", HKD: "HKD", CNY: "CNY",
};
const CURRENCY_RE = /US\$|\$|€|£|¥|\b(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|SEK|HKD|CNY)\b/g;

function currenciesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.match(CURRENCY_RE) ?? []) {
    found.add(CURRENCY_ALIASES[m] ?? CURRENCY_ALIASES[m.toUpperCase()] ?? m);
  }
  return found;
}

const INLINE_CITE_RE =
  /\[\s*\d+(?:\s*,\s*\d+)*\s*\]|\(\s*(?:sources?|refs?|see|citation)\.?\s*#?\s*\d+/i;

// ---------------------------------------------------------------- plan stage

const planSchemaValid: Scorer = {
  id: "plan/schema-valid",
  stage: "plan",
  describes: "The planner emitted JSON matching ResearchPlanSchema (3-6 angles, company, ticker).",
  threshold: 1,
  run: (t) => {
    if (!t.planCall) return NA;
    const parsed = ResearchPlanSchema.safeParse(t.plan);
    return bool(
      parsed.success,
      parsed.success ? "valid" : "invalid",
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  },
};

const planNoLiteralDates: Scorer = {
  id: "plan/no-literal-dates",
  stage: "plan",
  describes:
    "No angle query contains a full ISO date. A search engine reads 2026-09-13 as a literal token and it dilutes the real terms.",
  threshold: 1,
  run: (t) => {
    if (!t.plan) return NA;
    const failures = t.plan.angles.filter((a) => /\d{4}-\d{2}-\d{2}/.test(a.query)).map((a) => a.query);
    return ratio(t.plan.angles.length - failures.length, t.plan.angles.length, "queries clean", failures);
  },
};

const planRecencyAnchor: Scorer = {
  id: "plan/recency-anchor",
  stage: "plan",
  describes:
    "No angle query anchors on a year older than last year. Equity figures go stale fast and the prompt forbids it.",
  threshold: 1,
  run: (t) => {
    if (!t.plan) return NA;
    const floor = new Date(t.startedAt).getUTCFullYear() - 1;
    const failures: string[] = [];
    for (const a of t.plan.angles) {
      const stale = (a.query.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number).filter((y) => y < floor);
      if (stale.length) failures.push(`${a.query} → ${stale.join(", ")} (floor ${floor})`);
    }
    return ratio(t.plan.angles.length - failures.length, t.plan.angles.length, "queries recent", failures);
  },
};

const planNamesCompany: Scorer = {
  id: "plan/names-company",
  stage: "plan",
  describes:
    "Every angle query names the company or ticker. A query that restates the user's question retrieves the wrong company.",
  threshold: 1,
  run: (t) => {
    if (!t.plan) return NA;
    const ticker = t.plan.ticker.toLowerCase();
    const nameTokens = t.plan.company.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const failures = t.plan.angles
      .filter((a) => {
        const q = a.query.toLowerCase();
        return !q.includes(ticker) && !nameTokens.some((w) => q.includes(w));
      })
      .map((a) => a.query);
    return ratio(t.plan.angles.length - failures.length, t.plan.angles.length, "queries named", failures);
  },
};

const planPriceAngle: Scorer = {
  id: "plan/price-angle-present",
  stage: "plan",
  describes:
    "At least one angle is classified as a price angle. That classification is what routes the search to a week-wide news query, the only path that returns dated results.",
  threshold: 1,
  run: (t) => {
    if (!t.plan) return NA;
    const priced = t.plan.angles.filter((a) => searchOptionsFor(a.query).topic === "news");
    return bool(
      priced.length > 0,
      priced.length > 0 ? `${priced.length} price angle(s)` : "no price angle",
      priced.length > 0 ? [] : t.plan.angles.map((a) => a.query),
    );
  },
};

const planExpectedTicker: Scorer = {
  id: "plan/expected-ticker",
  stage: "plan",
  describes: "The planner resolved the company the golden case expected. Live mode only.",
  threshold: 1,
  run: (t, kase) => {
    if (!kase?.expectTicker || !t.plan) return NA;
    const got = t.plan.ticker.toUpperCase().replace(/[^A-Z.]/g, "");
    const want = kase.expectTicker.toUpperCase();
    return bool(got === want, `${got} vs expected ${want}`, got === want ? [] : [`resolved ${got}, expected ${want}`]);
  },
};

// ----------------------------------------------------------- retrieval stage

const retrievalAngleSuccess: Scorer = {
  id: "retrieval/angle-success",
  stage: "retrieval",
  describes:
    "Share of angles that returned at least one hit. The pipeline tolerates partial failure, so this degrades quietly — which is exactly why it is measured.",
  threshold: 0.9,
  run: (t) => {
    if (t.tavily.length === 0) return NA;
    const failures = t.tavily
      .filter((a) => a.results.length === 0)
      .map((a) => `${a.angleId}: ${a.error ?? "0 results"}`);
    return ratio(t.tavily.length - failures.length, t.tavily.length, "angles returned hits", failures);
  },
};

const retrievalDedup: Scorer = {
  id: "retrieval/source-dedup",
  stage: "retrieval",
  describes:
    "No two numbered sources are the same URL. Six angles overlap heavily; a duplicate wastes one of the 18 slots and lets one page look like two agreeing sources.",
  threshold: 1,
  run: (t) => {
    if (!t.thesis) return NA;
    const seen = new Map<string, string>();
    const failures: string[] = [];
    for (const s of t.thesis.sources) {
      const key = normalizeUrl(s.url);
      if (seen.has(key)) failures.push(`[${s.id}] duplicates ${seen.get(key)}: ${key}`);
      else seen.set(key, `[${s.id}]`);
    }
    return ratio(
      t.thesis.sources.length - failures.length,
      t.thesis.sources.length,
      "sources unique",
      failures,
    );
  },
};

const retrievalPriceDated: Scorer = {
  id: "retrieval/price-source-dated",
  stage: "retrieval",
  describes:
    "Hits on price angles carry a published date. Undated price hits are how a seven-month-old quote reaches synthesis looking current.",
  threshold: 0.8,
  run: (t) => {
    const priceAngles = t.tavily.filter((a) => searchOptionsFor(a.query).topic === "news");
    const hits = priceAngles.flatMap((a) => a.results.map((r) => ({ angle: a.angleId, r })));
    if (hits.length === 0) return NA;
    const failures = hits.filter((h) => !h.r.publishedDate).map((h) => `${h.angle}: ${h.r.url}`);
    return ratio(hits.length - failures.length, hits.length, "price hits dated", failures);
  },
};

// ----------------------------------------------------------- synthesis stage

const thesisSchemaValid: Scorer = {
  id: "thesis/schema-valid",
  stage: "synthesis",
  describes: "The synthesis output parsed as ThesisSchema. A failure here fails the whole run.",
  threshold: 1,
  run: (t) => {
    if (!t.synthesisCall) return NA;
    const parsed = ThesisSchema.safeParse(t.thesis);
    return bool(
      parsed.success,
      parsed.success ? "valid" : "invalid",
      parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  },
};

const citationValidity: Scorer = {
  id: "thesis/citation-validity",
  stage: "synthesis",
  describes:
    "Every sourceId points at a source that exists. A dangling id renders as a footnote mark with nothing behind it.",
  threshold: 1,
  run: (t) => {
    if (!t.thesis) return NA;
    const valid = new Set(t.thesis.sources.map((s) => s.id));
    let total = 0;
    let ok = 0;
    const failures: string[] = [];
    for (const b of citedBullets(t.thesis)) {
      for (const id of b.sourceIds) {
        total++;
        if (valid.has(id)) ok++;
        else failures.push(`${b.id} cites [${id}], which does not exist`);
      }
    }
    return ratio(ok, total, "citations resolve", failures);
  },
};

const citationCoverage: Scorer = {
  id: "thesis/citation-coverage",
  stage: "synthesis",
  describes:
    "Every bull/bear/catalyst/risk bullet and the price quote carries at least one citation. An uncited claim is indistinguishable from an invented one.",
  threshold: 1,
  run: (t) => {
    if (!t.thesis) return NA;
    const bullets = citedBullets(t.thesis);
    const failures = bullets.filter((b) => b.sourceIds.length === 0).map((b) => `${b.id}: "${b.text}"`);
    return ratio(bullets.length - failures.length, bullets.length, "claims cited", failures);
  },
};

const noInlineCitations: Scorer = {
  id: "thesis/no-inline-citations",
  stage: "synthesis",
  describes:
    "No text field contains a written-out citation marker. Citations belong in sourceIds; text markers double up with the rendered footnotes.",
  threshold: 1,
  run: (t) => {
    if (!t.thesis) return NA;
    const fields = narrativeFields(t.thesis);
    const failures = fields.filter((f) => INLINE_CITE_RE.test(f.text)).map((f) => `${f.id}: "${f.text}"`);
    return ratio(fields.length - failures.length, fields.length, "fields clean", failures);
  },
};

const styleLimits: Scorer = {
  id: "thesis/style-limits",
  stage: "synthesis",
  describes:
    "Length rules from the synthesis prompt: bullets <= 25 words, summary 60-90 words, valuationSummary 2-4 sentences, array cardinalities in range.",
  threshold: 0.95,
  run: (t) => {
    if (!t.thesis) return NA;
    const checks: { ok: boolean; label: string }[] = [];
    for (const b of citedBullets(t.thesis)) {
      if (b.id === "priceContext") continue;
      const n = words(b.text);
      checks.push({ ok: n <= 25, label: `${b.id}: ${n} words (max 25) "${b.text}"` });
    }
    const summaryWords = words(t.thesis.summary);
    checks.push({
      ok: summaryWords >= 60 && summaryWords <= 90,
      label: `summary: ${summaryWords} words (want 60-90)`,
    });
    const vs = sentences(t.thesis.valuationSummary);
    checks.push({ ok: vs >= 2 && vs <= 4, label: `valuationSummary: ${vs} sentences (want 2-4)` });
    const cardinality: [string, number, number, number][] = [
      ["bullCase", t.thesis.bullCase.length, 3, 5],
      ["bearCase", t.thesis.bearCase.length, 3, 5],
      ["catalysts", t.thesis.catalysts.length, 2, 4],
      ["risks", t.thesis.risks.length, 2, 4],
    ];
    for (const [name, n, min, max] of cardinality) {
      checks.push({ ok: n >= min && n <= max, label: `${name}: ${n} items (want ${min}-${max})` });
    }
    const failures = checks.filter((c) => !c.ok).map((c) => c.label);
    return ratio(checks.length - failures.length, checks.length, "style checks pass", failures);
  },
};

const priceContextSingleQuote: Scorer = {
  id: "thesis/price-single-quote",
  stage: "synthesis",
  describes:
    "priceContext quotes one listing in one currency and exchange names one venue. A dual-listed name is where this breaks.",
  threshold: 1,
  run: (t) => {
    if (!t.thesis) return NA;
    const text = priceContextOf(t.thesis).text;
    const currencies = currenciesIn(text);
    const exchange = t.thesis.exchange ?? "";
    const checks = [
      { ok: currencies.size <= 1, label: `priceContext mixes currencies (${[...currencies].join(", ")}): "${text}"` },
      {
        ok: !/[\/,]|\band\b/i.test(exchange),
        label: `exchange lists more than one venue: "${exchange}"`,
      },
    ];
    const failures = checks.filter((c) => !c.ok).map((c) => c.label);
    return ratio(checks.length - failures.length, checks.length, "price quote checks pass", failures);
  },
};

const priceContextDated: Scorer = {
  id: "thesis/price-dated",
  stage: "synthesis",
  describes:
    "The price quote is dated and cited. An undated quote reads as current no matter how old the source is.",
  threshold: 0.9,
  run: (t) => {
    if (!t.thesis) return NA;
    const pc = priceContextOf(t.thesis);
    const checks = [
      { ok: /\d{4}-\d{2}-\d{2}|\bas of\b/i.test(pc.text), label: `priceContext undated: "${pc.text}"` },
      { ok: pc.sourceIds.length > 0, label: `priceContext uncited: "${pc.text}"` },
    ];
    const failures = checks.filter((c) => !c.ok).map((c) => c.label);
    return ratio(checks.length - failures.length, checks.length, "price dating checks pass", failures);
  },
};

const numberProvenance: Scorer = {
  id: "thesis/number-provenance",
  stage: "synthesis",
  describes:
    "Every figure in a cited claim appears in one of the sources that claim cites. The single strongest deterministic check on hallucinated numbers. Expect a few honest misses: a derived figure (a YoY the model computed) is traceable to no snippet.",
  threshold: 0.85,
  run: (t) => {
    if (!t.thesis || !t.synthesisCall) return NA;
    const block = parseSourcesBlock(t.synthesisCall.user);
    if (block.size === 0) return NA;
    let total = 0;
    let ok = 0;
    const failures: string[] = [];
    for (const b of citedBullets(t.thesis)) {
      const nums = numericTokens(b.text);
      if (nums.length === 0) continue;
      const cited = b.sourceIds.map((id) => block.get(id)).filter(Boolean) as ParsedSource[];
      // Snippet and publish date only — deliberately not the title. A headline
      // figure is the least reliable number on a page: one source here is titled
      // "A $1,200 Target Comes Into Focus" while its body gives $1,011.88, and
      // counting the title as support would have scored that claim grounded.
      const pool = new Set(cited.flatMap((s) => numericTokens(`${s.snippet} ${s.published ?? ""}`)));
      for (const n of nums) {
        total++;
        if (numberIsTraceable(n, pool)) ok++;
        else failures.push(`${b.id}: "${n}" not in sources [${b.sourceIds.join(", ")}] — "${b.text}"`);
      }
    }
    return ratio(ok, total, "figures traceable to a cited source", failures);
  },
};

const sourceUtilisation: Scorer = {
  id: "thesis/source-utilisation",
  stage: "synthesis",
  describes:
    "Share of the numbered sources actually cited somewhere. A low score means retrieval paid for pages synthesis ignored — the ranking is surfacing the wrong 18.",
  threshold: 0.5,
  run: (t) => {
    if (!t.thesis || t.thesis.sources.length === 0) return NA;
    const used = new Set(citedBullets(t.thesis).flatMap((b) => b.sourceIds));
    const unused = t.thesis.sources.filter((s) => !used.has(s.id));
    return ratio(
      t.thesis.sources.length - unused.length,
      t.thesis.sources.length,
      "sources cited",
      unused.map((s) => `[${s.id}] uncited: ${s.url}`),
    );
  },
};

export const SCORERS: Scorer[] = [
  planSchemaValid,
  planNoLiteralDates,
  planRecencyAnchor,
  planNamesCompany,
  planPriceAngle,
  planExpectedTicker,
  retrievalAngleSuccess,
  retrievalDedup,
  retrievalPriceDated,
  thesisSchemaValid,
  citationValidity,
  citationCoverage,
  noInlineCitations,
  styleLimits,
  priceContextSingleQuote,
  priceContextDated,
  numberProvenance,
  sourceUtilisation,
];
