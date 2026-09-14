# Low-Level Design — Thesis (Deep Research for Investors)

> Function-level companion to [HLD.md](./HLD.md). All numbers are measured from real runs
> in `transcripts/` and from live traces, not estimated. Line references track `main`.

---

## 1. Module map

```
app/api/research/route.ts   POST handler                       40 loc
lib/pipeline.ts             runPipeline, PipelineError        130 loc
lib/groq.ts                 callGroq, parseJsonLoose           72 loc
lib/tavily.ts               searchAngle, runAllAngles          72 loc
lib/sources.ts              mergeAndNumberSources              61 loc
lib/schema.ts               3 Zod schemas + inferred types     55 loc
lib/prompts.ts              buildPlanPrompt, buildSynthesisPrompt  48 loc
lib/transcript.ts           createTranscript/addUsage/finalize 75 loc
lib/cache.ts                createLruCache, questionCacheKey   ~110 loc
lib/observability.ts        emitTrace (Langfuse replay)        ~215 loc
lib/mockThesis.ts           MOCK_THESIS fixture
app/page.tsx                client state machine              107 loc
components/*.tsx            9 presentational components
```

---

## 2. Stage 0 — Transport (`app/api/research/route.ts`)

```ts
export const maxDuration = 300;        // route.ts:4  — needs Fluid Compute
export const dynamic = "force-dynamic" // route.ts:5  — never cache/prerender
```

`POST` does four things in order (`route.ts:7-39`):

1. **Parse guard** — `await req.json()` inside try/catch → 400 `"Invalid request body"`.
2. **Length gate** — `< 4` chars → 400; `> 500` chars → 400. *This runs before any
   paid call*, so malformed or abusive input costs nothing downstream.
3. **Thesis cache** — `questionCacheKey(question)` → `thesisCache.get()`. A hit returns
   `{ thesis, cached: true, cachedAgeMs }` without touching Groq or Tavily. Placed in the
   route rather than the pipeline deliberately: `runPipeline` stays a pure "actually do
   the research" function with no cache branch inside it, and a hit writes no transcript
   because no run happened.
4. **Mock short-circuit** — `MOCK_RESEARCH === "1"` → `await import("@/lib/mockThesis")`
   (route.ts:24) and a 2.5s artificial delay so the progress UI is exercised. The
   **dynamic** import matters: the ~3 KB fixture is code-split out of the production
   server bundle instead of being a static dependency of a hot path.
5. **Dispatch + stage-tagged error mapping** (route.ts:29-39):

```ts
const stage = err instanceof PipelineError ? err.stage : "unknown";
return NextResponse.json({ error: err.message, stage }, { status: 502 });
```

502 (not 500) is correct here: every non-validation failure originates upstream at Groq
or Tavily. The `stage` field is what makes a failed run diagnosable from the response
body alone.

### 2.1 Cache design (`lib/cache.ts`)

`createLruCache<T>({ max, ttlMs })` — a `Map` whose insertion order *is* the recency list.
`get` deletes and re-inserts a live entry so it moves to the tail; `set` evicts from the
head while over capacity. Expiry is lazy (checked on read), so there is no timer to leak.

| Instance | Location | Key | max / TTL |
|---|---|---|---|
| `thesisCache` | `route.ts:10` | `questionCacheKey(question)` | 50 / 1h |
| `angleCache` | `tavily.ts` | raw Tavily query string | 200 / 1h |

**Why the angle cache earns more than the thesis cache.** A thesis-cache hit requires two
users to ask the *same question*. An angle-cache hit only requires two questions about the
same company, since the planner generates overlapping angles for a given ticker — and
Tavily credits (~12/run) are the scarcer resource, not Groq tokens.

**Key normalization is deliberately conservative** (`cache.ts`): lowercase, collapse
whitespace, strip trailing `?.!`. Nothing more. The asymmetry decides it — under-
normalizing costs a cache miss, over-normalizing serves the *wrong research note*.
"bull case on X" and "bear case on X" must never collide.

**Three correctness rules:**

| Rule | Where | Reason |
|---|---|---|
| Degraded runs are not cached | `route.ts` (`warnings.length === 0`) | One transient Tavily failure must not become an hour of half-researched output |
| Failed searches are not cached | `tavily.ts` (`results.length > 0`) | Never memoize an empty result set |
| Hits are labelled in the UI | `page.tsx` "Cached result" banner | The report header says "Generated <today>"; an unlabelled hour-old thesis would read as fresh |

TTL is 1 hour because equity figures move intraday. A longer TTL would raise the hit rate
by serving stale theses as current — a correctness problem, not a cache-tuning one.

`RESEARCH_CACHE=0` disables both layers via a single flag read at construction.

**Unit-verified:** LRU recency (touching `a` before inserting `d` evicts `b`, not `a`),
TTL expiry, kill switch, and that bull/bear questions produce distinct keys.

**Live-verified** (four runs against the real APIs, 2026-09-14):

| Run | Request | Result |
|---|---|---|
| 1 | "Is Nvidia (NVDA) a buy given current datacenter capex trends?" | 200, cold, **11.5s**, 6,070 tokens, 18 sources |
| 2 | Same question, verbatim | **5.5ms**, `cached: true`, byte-identical thesis |
| 3 | Same question, different case / spacing / no `?` | **3.2ms**, `cached: true` — key normalization confirmed |
| 4 | "What is the bear case on Nvidia (NVDA) at current valuation?" | 10.2s, **1 of 6 angles served from cache** (2 of 12 Tavily credits saved) |

Run 4 is the honest measure of the angle cache: the planner rephrases most angles between
questions ("valuation multiples 2026" vs "valuation multiples P/E P/S 2026"), so exact-string
matching only catches the angles it happens to word identically — here just the Q2 earnings
one. The layer is worth its ~30 lines but it is a marginal saver, not a step change; a
normalized or embedding-based angle key would raise the hit rate if it ever matters.

---

## 3. Stage 1 — Plan (`lib/prompts.ts:3-15`, `lib/pipeline.ts:28-62`)

**Model:** `openai/gpt-oss-20b` (`pipeline.ts:8`).

**Prompt construction** — the system prompt is rebuilt per request because it embeds
`new Date().toISOString().slice(0,10)` (`prompts.ts:4`). The user message is the raw
question; nothing else. Three behavioural rules carry the weight:

| Rule | Why it exists |
|---|---|
| `"Today's date is <date>"` | The model's training cutoff otherwise anchors queries in a stale year. |
| `"Always make one angle a current share price / valuation snapshot query"` | Guarantees `priceContext` is fillable in stage 3. |
| `"Never write a query that anchors on a year more than one year before today"` | Direct fix for observed "Nvidia Q2 2024 earnings" queries. |
| `"...includes the company name and ticker, not a restatement of the user's raw question"` | Restated questions are low-signal search strings; ticker-bearing queries are high-signal. |
| `"express recency as a YEAR or QUARTER LABEL, never a full calendar date"` + wrong/right pair | Live runs emitted `"Palantir PLTR bear case risks 2026-09-13"` — the date is a literal token to a search engine, diluting the real terms. |

**`currentPeriod()`** (`prompts.ts`) derives `year`, `quarter`, and the most recently
*reported* quarter (the previous one, since companies report after a quarter closes,
with a Q1 → Q4-of-last-year rollover) and hands those to the prompt, so the model has a
correct label to reach for instead of the raw date.

**`stripLiteralDates()`** is the deterministic backstop, applied in `pipeline.ts` right
after plan validation: `\b(\d{4})-\d{2}-\d{2}\b` → `$1`. Prompt rules drift between
model versions; a regex does not. Verified against the real transcript queries — ISO
dates collapse to their year, and an already-correct `"Q4 2025"` label is left untouched.

**Output contract** (`schema.ts:32-37`):

```ts
ResearchPlanSchema = { company, ticker, exchange?, angles: ResearchAngle[3..6] }
```

`.min(3).max(6)` is not cosmetic — it is the hard ceiling on Tavily credits per run and
on stage-2 wall time. A model that returns 20 angles fails validation instead of
quintupling the bill.

**Measured:** 550–814 total tokens, 583–1364 ms across 6 runs. Every run produced
exactly 6 angles.

**Failure path:** `parseJsonLoose` → `ResearchPlanSchema.parse` inside one try/catch
(`pipeline.ts:52-61`), rethrown as `PipelineError(..., "plan")`.

---

## 4. Stage 2 — Research

### 4.1 Single search (`lib/tavily.ts:10-47`)

```ts
{ query, search_depth: "advanced", max_results: 5,
  include_answer: false, include_raw_content: false, time_range: "year" }
```

Four separate tuning decisions in one body:

- `search_depth: "advanced"` — the one place we spend *more*, because snippet quality
  directly determines thesis quality, and snippets are the thing we then aggressively trim.
- `max_results: 5` — 6 angles × 5 = 30 hits, comfortably above the 18 we keep, so the
  dedupe/ranking step has real choice without paying for 10-result pages.
- `include_answer: false` — Tavily's own summary would be a *second* model's opinion
  leaking into our synthesis context. Refused on both cost and provenance grounds.
- `include_raw_content: false` — full page text would be 10–50× the payload for content
  we truncate to 350 chars anyway.
- `time_range: "year"` — added after live testing showed two-year-old quarterly figures
  being cited as current (`tavily.ts:28-30`).

The response is defensively mapped, not spread: every field gets a fallback
(`r.title ?? "Untitled"`, `score` type-checked) so one malformed hit cannot poison
downstream sorting with `undefined`.

### 4.2 Fan-out (`lib/tavily.ts:56-72`)

```ts
const settled = await Promise.allSettled(angles.map(async (a) => { ...timed, retried... }));
```

**This is the largest latency optimization in the codebase.** Measured per run:

| Run | Σ serial ms | max (= wall) ms | speedup |
|---|---|---|---|
| nvda-2 | 27,685 | 9,428 | 2.9× |
| nvda-4 | 22,977 | 9,598 | 2.4× |
| costco | 20,399 | 4,448 | 4.6× |
| pltr-6 | 18,577 | 4,096 | 4.5× |
| pltr-7 | 26,048 | 8,773 | 3.0× |

Serialized, stage 2 alone would exceed 20s and push several runs past the Hobby-tier
60s limit. Timing is captured *per angle* inside the map, so the transcript records the
real distribution rather than just the aggregate.

### 4.2.1 Partial-failure handling

`Promise.all` was fail-fast: one rejected angle aborted a run that five healthy angles
could have carried — *after* the planning call had already been paid for. Four mechanisms
now sit in `runAllAngles` / `searchAngleWithRetry`:

| Mechanism | Constant | Behaviour |
|---|---|---|
| Settle-don't-throw | — | `Promise.allSettled`; failures become `log[].error` + `failures[]` |
| Survivor floor | `MIN_SUCCESSFUL_ANGLES = 2` | Below it, `ResearchFanoutError` — a one-angle thesis fails loudly rather than reading as complete |
| Per-angle timeout | `PER_ANGLE_TIMEOUT_MS = 12_000` | `AbortSignal.timeout`; a hung angle can't ride the 300s ceiling |
| Selective retry | `MAX_ATTEMPTS = 2` | `isRetryable`: 429 / 5xx / transport only. 4xx and a missing key fail on attempt 1 |

Retry backoff is `400ms × attempt + up to 300ms jitter` — the jitter exists because six
concurrent angles hitting one 429 would otherwise all retry in the same instant.

Degradation is surfaced, not swallowed: `pipeline.ts` pushes a `warnings[]` entry, the
route returns it alongside the thesis, and `page.tsx` renders a "Partial research" banner.
A thesis built on 4 of 6 angles must not be visually indistinguishable from a full one.

Verified against a stubbed `fetch`:

| Scenario | Result |
|---|---|
| 401 on one of six angles | 5 succeeded, 1 failed, run completed |
| Transient 503 on one angle | Retried, recovered, 0 failures (`attempts: 2`) |
| 401 (permanent) | 1 fetch call — not retried |
| All six fail | `ResearchFanoutError`, no thesis produced |
| One angle hangs | 5 succeeded, wall time 24.4s (= 12s × 2 attempts), not 300s |

### 4.3 Context curation (`lib/sources.ts`)

This module is where token cost is actually decided. Four operations, in order:

**(a) URL normalization** (`sources.ts:4-19`) — strip `?query`, `#hash`, `www.`,
lowercase the host, drop a trailing slash. Wrapped in try/catch with a
`url.trim().toLowerCase()` fallback so an unparseable URL degrades to string identity
instead of throwing mid-pipeline.

**(b) Dedupe, longest-snippet-wins** (`sources.ts:35-46`):

```ts
if (!existing || existing.content.length < hit.content.length) seen.set(key, hit);
```

Not first-wins. When two angles surface the same article, the hit carrying more text is
kept — the same URL can return different snippet lengths depending on which query matched
it, and we want the richer one. Measured: 30 raw → 26–29 unique (3–13% overlap between
angles; overlap is the signal that the planner's angles are distinct enough).

**(c) Rank and cap** (`sources.ts:48-50`):

```ts
const ordered = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_SOURCES); // 18
```

Ranking *before* slicing means the 8–11 dropped hits are the lowest-relevance ones, not
arbitrary ones.

**(d) Truncate and number** (`sources.ts:51-58`):

```ts
const SNIPPET_CHARS = 350;   // avg raw snippet measured at 1,520–1,868 chars
`[${i+1}] ${title} — ${url}\n${truncate(content, 350)}`
```

The compounding effect, measured:

```
30 hits × ~1,700 chars   ≈ 51,000 chars  of raw snippet text
18 hits ×    350 chars   ≈  6,300 chars  reaching the prompt
                         → ~88% of retrieved text discarded
```

That is what took the synthesis prompt from **5,170 → ~3,200 tokens (−38%)**. The
comment at `sources.ts:26-27` records the forcing function: Groq's free tier rejects
requests over 8k tokens/minute *including* the completion — transcript #3 is the
preserved 413.

The function returns **two** representations of the same list: `sourcesBlock` (text for
the prompt) and `sources: Source[]` (structured, for the renderer). Building both from
one `ordered` array is what makes citation IDs provably consistent between what the model
saw and what the footnotes show.

---

## 5. Stage 3 — Synthesis

### 5.1 The LLM adapter (`lib/groq.ts`)

```ts
temperature: opts.temperature ?? 0.25,
response_format: { type: "json_object" },
reasoning_effort: "low",
```

- **`temperature: 0.25`** — low but non-zero. Extraction/formatting work; determinism is
  worth more than variety.
- **`response_format: json_object`** — constrained decoding at the API level. Removes the
  entire class of "model wrote a preamble before the JSON".
- **`reasoning_effort: "low"`** (`groq.ts:38-40`) — the single completion-side lever.
  Both calls are extraction and formatting, not open-ended reasoning, so the reasoning
  budget was pure waste. Measured: completion **3,072 → 1,653–2,341 tokens (−33 to −46%)**.
- **Error handling** — `res.text().catch(() => "")` then `.slice(0, 500)`: upstream error
  bodies are surfaced for diagnosis but bounded so a giant HTML error page cannot flood
  the log or the response.
- **`usage` fallback** to zeros (`groq.ts:56-60`) so accounting never throws on a
  response missing the field.

**`parseJsonLoose`** (`groq.ts:65-72`) strips ` ```json ` fences before `JSON.parse`.
Belt-and-braces on top of JSON mode: it costs three regexes and removes a whole failure
class if the API ever degrades or a model is swapped for one without JSON mode.

### 5.2 The analyst prompt (`lib/prompts.ts:17-48`)

**Model:** `openai/gpt-oss-120b` — the only place the larger tier is used.

The prompt encodes four categories of rule, each traceable to an observed failure:

| Category | Rule | Origin |
|---|---|---|
| Grounding | "Use ONLY the numbered sources… never invent data" | Hallucinated figures |
| Recency | "always label a figure with its period (e.g. 'Q2 FY2027')" | Stale data presented as current |
| Length | bullets ≤ 25 words; summary 60–90 words; valuation 2–4 sentences; "no filler phrases" | Direct completion-token control |
| Format | "Citations belong ONLY in sourceIds arrays. Never write '(source 4)' or '[4]' into any text field" | Model was inlining citations, duplicating what `CitedList` renders as superscripts |
| Correctness | The worked counter-example: *WRONG: "P/E of 149 is far above the 3-year average of 202" / RIGHT: "…sits below…"* | Live runs produced directionally backwards comparisons |

The counter-example is worth isolating as a technique: a rule stated abstractly
("comparisons must be correct") did not fix it; a concrete wrong/right pair did.

The user message (`prompts.ts:39-45`) is deliberately thin — question, company/ticker,
the source block, and the instruction to mirror source IDs. All stable instruction text
lives in the system message.

### 5.3 Validation and source override (`lib/pipeline.ts:99-117`)

```ts
const rawThesis = parseJsonLoose<Record<string, unknown>>(synthesisResult.content);
rawThesis.sources = sources;              // pipeline.ts:103 — server wins
const parsed = ThesisSchema.safeParse(rawThesis);
```

**The override is a correctness guarantee, not a convenience.** The model is asked to
echo the 18 sources so its `sourceIds` stay anchored, but its echo is discarded and
replaced with the server's own list. A truncated URL, a paraphrased title or a dropped
entry therefore cannot reach the footnotes. Citation integrity does not depend on the
model transcribing 18 URLs correctly.

`safeParse` (not `parse`) is used because the result is recorded in the transcript
either way (`pipeline.ts:105-107`) before being rethrown — a failed run still yields a
full diagnostic artifact including the exact Zod issues.

**`ThesisSchema` as a token budget** (`schema.ts:40-54`):

```ts
bullCase: min(3).max(5)     bearCase: min(3).max(5)
catalysts: min(2).max(4)    risks:    min(2).max(4)
rating: enum(["Buy","Hold","Sell"])
financials: all 7 fields .optional()
```

`min` enforces substance; `max` enforces brevity. The `enum` is what lets `RatingBadge`
be a total lookup (`Record<Thesis["rating"], string>`) with no default branch. The
all-optional `financials` is what lets the prompt say "omit what you cannot support"
without the response failing validation — `FinancialsTable` then filters empty rows
(`FinancialsTable.tsx:17`) and renders a fallback line if all seven are missing.

**Measured stage 3:** 2,962–3,522 prompt / 1,653–2,341 completion, 4,062–7,260 ms.

---

## 6. Observability (`lib/transcript.ts`)

`RunTranscript` captures, per run: `runId` (UUID), `startedAt`, question, the parsed
plan, **both LLM calls in full** (model, system, user, raw response, usage, ms), every
Tavily query with its results and timing, the validation outcome, cumulative token
totals, `totalMs`, and `error` if any.

Two details that make it actually useful:

- **`finalizeTranscript` is called on both paths** (`pipeline.ts:121` success,
  `pipeline.ts:127` in the catch). Failed runs are the ones worth reading, so they are
  written too — with `error` and whatever partial state was reached.
- **Write failures are swallowed** (`transcript.ts:71-74`, `console.error` + return
  null). Instrumentation must never be able to fail a successful research run.
- **Vercel guard** (`transcript.ts:57-61`) — `process.env.VERCEL` short-circuits before
  touching the filesystem, since the serverless FS is ephemeral/read-only.

The filename is `<ISO timestamp with : and . replaced by ->_<slug>.json`, where `slugify`
(`transcript.ts:48-54`) lowercases, collapses non-alphanumerics to `-`, trims leading and
trailing dashes and caps at 40 chars — sortable by name, human-identifiable, filesystem-safe.

This trace is the reason §7 contains measurements rather than guesses.

---

## 6.1 Langfuse tracing (`lib/observability.ts`)

`emitTrace(transcript)` reconstructs a Langfuse trace from a **completed** `RunTranscript`
rather than instrumenting the pipeline inline. See [HLD §12](./HLD.md#12-observability-in-production-libobservabilityts)
for why. Implementation details that are easy to get wrong:

| Detail | Why |
|---|---|
| `after()` from `next/server` wraps the call in `route.ts` | Flushing before returning would add its latency to every request; `after` runs post-response and still keeps the function alive |
| `Promise.race` with `FLUSH_TIMEOUT_MS = 2_500` | `after` work counts against `maxDuration`; an unreachable Langfuse must not eat the budget |
| One `create` event per observation, carrying both `startTime` and `endTime` | Two separate bugs sit here. `.end()` forbids an explicit `endTime` and stamps *now*, collapsing a replay onto the emission instant. Splitting into create-then-`.update()` avoids that but the SDK batches events without preserving call order, and a create landing after its own update leaves `endTime == startTime` — which is exactly how the first live traces came back: generations at 0.00s next to correctly-timed spans. A replay knows everything upfront, so one complete event is both simpler and the only order-independent option. |
| `startedAt` added to `LlmCallLog` / `AngleSearchLog` | A timeline needs wall-clock positions; `ms` durations alone cannot place a span |
| Client memoized as `null` when unconfigured | One env check for the process, not one per run |
| Whole body in `try/catch`, returns `null` on failure | Observability must never fail a run that otherwise succeeded |
| `ResearchFanoutError` carries `log` + `failures` | Found in testing: a hard fan-out failure threw before `transcript.tavily` was assigned, producing a trace with a research stage containing **no searches** — the exact diagnostic you need |

**Verified end-to-end** against a stub ingestion server plus live runs:

| Scenario | Result |
|---|---|
| No `LANGFUSE_*` keys | `tracingEnabled() === false`, `emitTrace` returns null, run unaffected |
| Replay of a stored transcript | 19 events: trace + plan/synthesis generations + research span + 6 angle spans, token usage intact |
| Unreachable Langfuse host | No throw, bounded at exactly 2.5s |
| **Live failure run** (invalid Tavily key) | 502 in 1.6s, then `after()` emitted 18 events — 6 ERROR spans carrying the real 401 text, tags `["error","degraded","COST"]` |
| **Live success run** (COST, 11.6s) | 10 observations, tags `["ok","COST"]`, metadata `{prompt:3504, completion:2208}`, 7 distinct start times across 6.8s — the parallel fan-out is visible as parallel in the timeline |
| **Live run against Langfuse Cloud** (AVGO) | Read back through the public API: 9 observations, 6 angle spans correctly nested under `research`, **zero zero-duration observations**, timeline `plan 0.82s → research 4.49s → synthesis 4.33s` against a 9.64s trace latency |

Note when verifying by API: Langfuse Cloud ingestion is asynchronous. A trace fetched
~5s after a run can return a partial observation list; the same trace at ~25s was
complete. A missing observation right after a run is lag, not loss.

---

## 7. Optimization catalogue

### 7.1 Token cost — before and after

The same question, run before and after the optimization commit (`5b47b28`):

|  | prompt | completion | total | wall |
|---|---|---|---|---|
| Before (transcript #2) | 5,170 | 3,072 | **9,056** | 17.8s |
| After (transcript #4) | 2,962 | 2,341 | **5,866** | 16.5s |
| After (costco) | 3,056 | 2,027 | 5,645 | 10.0s |
| After (pltr) | 3,231 | 1,653 | **5,450** | 9.0s |

**−35 to −40% tokens, with better output quality.** Attribution:

- prompt side (−38%): `MAX_SOURCES = 18` + `SNIPPET_CHARS 500 → 350`
- completion side (−33 to −46%): `reasoning_effort: "low"`

### 7.2 The structural optimization

The largest saving is not in this table because it was never paid. **Only one call
generates content.** The plan call emits search queries (~250 completion tokens); the
report's structure, headings, spacing, columns, tables and citation superscripts come
from React. An architecture that asked a model to write or format the report per section
would multiply completion tokens by roughly the section count and re-introduce every
formatting-drift bug that `ThesisSchema` currently makes impossible.

### 7.3 Latency

| Lever | Effect |
|---|---|
| `Promise.all` over 6 angles | 19.7–27.7s serial → 4.1–9.6s wall (2.4–4.6×) |
| `reasoning_effort: "low"` | Fewer completion tokens ⇒ proportionally shorter TTLT |
| 20b for planning | 0.6–1.4s vs. several seconds on the larger tier |
| `maxDuration = 300` + Fluid Compute | Not a speedup — it prevents the 60s-cap 504 |

### 7.4 Quality optimizations (no token cost)

| Fix | Mechanism |
|---|---|
| Stale data | `time_range: "year"` + date in both prompts + "label the period" |
| Backwards comparisons | Worked wrong/right counter-example in the prompt |
| Inline citation noise | Explicit "citations belong ONLY in sourceIds" |
| Corrupted source list | Server overwrites `rawThesis.sources` |
| Weak sources crowding strong ones | Score-sort *before* the 18-item slice |
| Duplicate articles | URL normalization + longest-snippet-wins dedupe |

### 7.5 Frontend

- **8 of 10 components are React Server Components** — only `page.tsx`, `QuestionForm`
  and `ProgressStages` carry `"use client"`. `ReportView` and its whole subtree ship
  zero JS: every entrance animation is a CSS keyframe, with no animation library and
  no scroll listener anywhere in the subtree.
- **`next/font`** (`layout.tsx:5-14`) self-hosts Source Serif 4 and Inter and exposes
  them as CSS variables — no external font request, no FOUT, no layout shift.
- **Tailwind v4 `@theme inline`** (`globals.css`) — the palette is defined once as CSS
  custom properties and projected into Tailwind's token space, so `text-buy` /
  `bg-sell-bg` resolve without a JS config file.
- **Progress simulation** (`page.tsx:11-36`) — a 250 ms interval walks a 3-entry timing
  table. Cheaper than SSE and honest about the pipeline's known shape.
- **Anchor-based citations** — `CitedList` renders `<a href="#src-{id}">` superscripts;
  `SourcesFootnotes` renders `id="src-{id}"`. Cross-referencing is pure HTML: no JS,
  no scroll handler, works with JS disabled.
- **Fixture banner** — a mock run is visually labelled as sample data, so an
  illustrative report can never be mistaken for live research.
- **Staggered reveal** — one `.reveal` class keyframes `fade-up`, with order supplied
  per element as `--i` (index) or `--d` (explicit delay). Sections, bullets, stat cells
  and footnotes all reuse it, so sequencing is data, not bespoke CSS per component.
- **`ReportSkeleton`** — a ghost of the real document shown during the 9–17s run.
  A wait behind one progress line reads as a hang; the same wait behind the shape of
  the document that is coming reads as work in progress.
- **Indeterminate progress rail** — the pipeline returns a single response, so the rail
  animates without claiming a percentage it cannot know.
- **`prefers-reduced-motion`** collapses every animation and transition to 0.01ms and
  drops the skeleton shimmer.
- **Print styles** — research notes get printed. `@page` margins, `.no-print` strips the
  form, progress rail and sticky bar, animations are forced to their end state, and
  `.print-break-avoid` keeps sections whole across pages.
- **Status colour is never alone** — `scripts/validate_palette.js` puts hold↔buy at
  ΔE 6.0 under protanopia, inside the floor band that is legal *only* with secondary
  encoding. So `RatingBadge` ships a direction glyph plus the word, and the bull/bear
  columns are labelled; hue only reinforces.

---

## 8. Error propagation table

| Origin | Detected at | `stage` | HTTP | Transcript written? |
|---|---|---|---|---|
| Bad JSON body | `route.ts:12` | — | 400 | no |
| Question too short/long | `route.ts:16-21` | — | 400 | no |
| `GROQ_API_KEY` unset | `groq.ts:23` | plan | 502 | yes |
| Groq non-2xx (404 retired model, 413 rate cap) | `groq.ts:48` | plan/synthesis | 502 | yes |
| Plan JSON malformed or off-shape | `pipeline.ts:52-61` | plan | 502 | yes |
| Some angles fail | `runAllAngles` | — | 200 + `warnings[]` | yes (`researchFailures`) |
| <2 angles survive | `ResearchFanoutError` | research | 502 | yes |
| 0 usable sources | `pipeline.ts` guard | research | 502 | yes |
| Thesis fails `ThesisSchema` | `pipeline.ts:104-110` | synthesis | 502 | yes (with Zod issues) |
| Transcript write fails | `transcript.ts:71` | — | — | logged, run unaffected |

---

## 9. Extension points

| Want to… | Touch |
|---|---|
| Add a report section | `ThesisSchema` + the synthesis prompt's shape line + one component in `ReportView` |
| Swap models | `PLAN_MODEL` / `SYNTHESIS_MODEL` (`pipeline.ts:8-9`) |
| Swap search provider | `lib/tavily.ts` only — `runAllAngles`'s return shape is the contract |
| Tune the token budget | `MAX_SOURCES`, `SNIPPET_CHARS` (`sources.ts:28-29`) |
| Tune fan-out resilience | `PER_ANGLE_TIMEOUT_MS`, `MAX_ATTEMPTS`, `MIN_SUCCESSFUL_ANGLES` (`tavily.ts:11-17`) |
| Add real streaming | Route → SSE; replace `STAGE_TIMINGS` with server events |
| Change what is traced | `emitTrace` in `lib/observability.ts` — one function, no pipeline changes |
| Tune cache behaviour | `THESIS_TTL_MS` (`route.ts:9`), `angleCache` bounds (`tavily.ts`), `RESEARCH_CACHE=0` to disable |
| Share cache across instances | Swap `createLruCache` for a Redis-backed object with the same `get`/`set` shape |
