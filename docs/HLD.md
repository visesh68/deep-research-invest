# High-Level Design — Thesis (Deep Research for Investors)

> Scope: the whole system as of the current `main`. Companion document:
> [LLD.md](./LLD.md) for function-level detail, exact constants and measured numbers.

## 1. What the system does

One input: a free-text investing question ("Is Nvidia a buy given current datacenter
capex trends?"). One output: a cited, structured equity research note rendered as a
banker-style document — rating, thesis summary, bull/bear columns, financials table,
valuation paragraph, catalysts/risks, numbered source footnotes.

The whole thing is a **three-stage pipeline behind a single POST request**. There is no
database, no job queue, no auth, no streaming protocol. That is a deliberate constraint,
not an omission — see §6.

## 2. System context

```
   ┌─────────────┐
   │   Browser   │   React client component (app/page.tsx)
   └──────┬──────┘
          │ POST /api/research  { question }
          │ (single request, held open up to 300s)
          ▼
   ┌──────────────────────────────────────────────────┐
   │  Next.js Route Handler (Node runtime, Vercel)    │
   │  app/api/research/route.ts                       │
   │   · input validation   · MOCK_RESEARCH short-cct │
   │   · stage-tagged error mapping                   │
   └──────┬───────────────────────────────────────────┘
          │ runPipeline(question)
          ▼
   ┌──────────────────────────────────────────────────┐
   │  Orchestrator — lib/pipeline.ts                  │
   └───┬─────────────┬──────────────┬─────────────────┘
       │             │              │
       ▼             ▼              ▼
   ┌────────┐   ┌─────────┐   ┌───────────┐      ┌──────────────┐
   │ Groq   │   │ Tavily  │   │ Groq      │      │ transcript   │
   │ 20b    │   │ ×N par. │   │ 120b      │      │ .json (dev)  │
   │ PLAN   │   │ SEARCH  │   │ SYNTHESIZE│      │ lib/transcript│
   └────────┘   └─────────┘   └───────────┘      └──────────────┘
                                    │
                                    ▼  validated Thesis JSON
                            ┌──────────────────┐
                            │ React render     │
                            │ components/*.tsx │
                            │ (zero LLM calls) │
                            └──────────────────┘
```

External dependencies: **Groq** (chat completions, OpenAI-compatible) and **Tavily**
(web search). Both free-tier. No other network egress.

## 3. Component inventory

| Layer | Files | Responsibility |
|---|---|---|
| Transport | `app/api/research/route.ts` | Validate, dispatch, map errors to HTTP |
| Orchestration | `lib/pipeline.ts` | Sequence the 3 stages, own the transcript, tag failures by stage |
| LLM adapter | `lib/groq.ts` | One `fetch` wrapper; JSON-mode; usage accounting; tolerant JSON parse |
| Search adapter | `lib/tavily.ts` | One search call + the fan-out driver (`runAllAngles`) |
| Context builder | `lib/sources.ts` | Dedupe → rank → cap → number → format the prompt's source block |
| Contracts | `lib/schema.ts` | Zod schemas that are simultaneously the type system, the validator, and the output-length budget |
| Prompts | `lib/prompts.ts` | The two system prompts; the only place model behaviour is tuned |
| Observability | `lib/transcript.ts` | Full run trace to `transcripts/*.json` (dev only) |
| Observability | `lib/observability.ts` | Replays a finished transcript as a Langfuse trace (prod + dev) |
| Presentation | `app/page.tsx`, `components/*` | Client state machine + deterministic renderer |
| Fixture | `lib/mockThesis.ts` | Credit-free UI path under `MOCK_RESEARCH=1` |
| Evals | `evals/*` | Scores finished transcripts: 18 deterministic scorers + 3 model-graded, thresholds, non-zero exit |

The dependency graph is strictly acyclic and one-directional: `route → pipeline →
{groq, tavily, sources, prompts, transcript} → schema`. No module imports the
orchestrator; no `lib` module imports React.

## 4. Runtime flow

```
t=0.0s   POST arrives. Validate length (4..500). If MOCK_RESEARCH → fixture + 2.5s sleep.
t=0.0s   createTranscript(): runId, startedAt, zeroed token counters.

STAGE 1 — PLAN                                            [~0.6–1.4s, ~560 tokens]
         Groq gpt-oss-20b, JSON mode, reasoning_effort=low.
         In : question + planner system prompt (carries today's date).
         Out: { company, ticker, exchange, angles[3..6] }
         ResearchPlanSchema.parse() — throws PipelineError(stage:"plan") on drift.

STAGE 2 — RESEARCH                                        [~4–10s wall, 0 tokens]
         6 Tavily queries issued CONCURRENTLY via Promise.allSettled.
         Per angle: 12s timeout, 1 retry on 429/5xx. Failures are recorded,
         not fatal — the run proceeds if >=2 angles survived.
         5 results each → up to 30 raw hits.
         mergeAndNumberSources(): normalize URL → dedupe → sort by score
                                → keep top 18 → truncate snippets to 350 chars
                                → emit "[n] title — url\nsnippet" block + Source[].

STAGE 3 — SYNTHESIZE                                      [~4–7s, ~3.2k in / ~1.9k out]
         Groq gpt-oss-120b, JSON mode, reasoning_effort=low.
         In : question + company/ticker + the numbered source block + analyst prompt.
         Out: full thesis JSON.
         Server OVERWRITES rawThesis.sources with its own numbered list (never trusts
         the model's echo), then ThesisSchema.safeParse().

t≈9–17s  finalizeTranscript() → transcripts/<ts>_<slug>.json (skipped on Vercel).
         200 { thesis }  →  React renders. No further model calls, ever.
```

Client-side, the progress indicator is driven by a 250 ms timer against a fixed
`STAGE_TIMINGS` table (0s / 5s / 20s) — the server returns one response, so stage
display is a faithful *model* of the run shape rather than live telemetry. This is a
conscious trade: honest UX feedback without paying for SSE plumbing.

## 5. Data contracts

Three schemas carry the whole system (`lib/schema.ts`):

- **`ResearchPlanSchema`** — gate between stage 1 and 2. `angles: min(3).max(6)` bounds
  the Tavily fan-out, which bounds both search credits and stage-2 latency.
- **`ThesisSchema`** — gate between stage 3 and the renderer. Its `min`/`max` on every
  array (`bullCase` 3–5, `catalysts` 2–4, …) is *the output token budget expressed as a
  type*, and its `rating: enum` is what lets `RatingBadge` be a pure lookup table.
- **`SourceSchema`** — server-authored, never model-authored.

Because the renderer consumes a validated `Thesis`, every component is total: no
component needs a loading state, an error branch, or a null guard beyond the optional
`exchange` and the optional `financials` fields.

## 6. Design principles (and what they bought)

1. **Exactly one LLM call produces content.** The plan call emits search queries, not
   prose. Layout, headings, spacing and citation superscripts come from React, not from
   asking a model to "format a report". This is the single largest cost decision in the
   codebase — the alternative (per-section generation, or an LLM formatting pass) would
   multiply tokens by roughly the number of sections.
2. **Cheap model for cheap work.** 20b plans, 120b synthesizes. The planner's job is
   entity extraction plus query writing; it does not need the frontier tier.
3. **The context window is curated, not dumped.** Stage 2 produces ~52k characters of
   raw snippet text; stage 3 receives ~6.3k. See §7.
4. **Schemas are the guardrail, not retries.** There is no repair loop. Validation
   failure is a stage-tagged 502 with the Zod messages attached, which is honest and
   costs nothing when things go right.
5. **Determinism at the edges.** `temperature: 0.25`, JSON response mode, server-owned
   source numbering. Two runs of the same question produce the same *shape*.
6. **Observability is a first-class artifact.** Every local run writes both prompts, both
   raw responses, every query and hit, per-call usage and timings. That trace is what
   made the §7 optimizations measurable rather than speculative.

## 7. Optimization summary by stage

Each entry is covered in full, with the measurement, in [LLD.md §7](./LLD.md#7-optimization-catalogue).

| Stage | Optimization | Effect |
|---|---|---|
| Transport | Length gate 4–500 chars before any paid call | Junk input costs $0 |
| Transport | `MOCK_RESEARCH=1` fixture path + dynamic `import()` | Demo the UI at zero credits; fixture never enters the prod bundle |
| Transport | In-process LRU thesis cache (50 entries, 1h TTL) | Repeat question: **11.5s → 5.5ms**, 0 tokens, 0 credits (measured) |
| Transport | `maxDuration = 300` + Fluid Compute | Avoids 504 on the 60s Hobby cap |
| Plan | Smallest model (20b) for extraction-shaped work | ~560 tokens/run, sub-second |
| Plan | Date injected into the prompt; "no year older than one year" rule | Killed stale-quarter queries |
| Plan | Year/quarter labels instead of ISO dates + `stripLiteralDates` backstop | Live run now emits `"Nvidia NVDA Q2 2026 earnings revenue margins"`, no ISO dates |
| Plan | `angles` capped at 6 by schema | Hard ceiling on search credits |
| Research | `Promise.allSettled` fan-out | **19.7–27.7s serial → 4.1–9.6s wall (~4–5×)** |
| Research | Partial-failure tolerance + survivor floor (≥2 angles) | One dead angle degrades the run instead of killing it |
| Research | 12s per-angle timeout + 1 jittered retry on 429/5xx | Worst case bounded at ~24s, not the 300s ceiling |
| Research | In-process LRU angle cache (200 entries, 1h TTL) | Marginal: 1 of 6 angles reused across two NVDA questions (measured) |
| Research | `time_range: "year"` | Stopped 2-year-old figures being cited as current |
| Research | `include_raw_content: false`, `max_results: 5` | Smaller payloads, fewer credits |
| Context | URL normalization + dedupe (longest snippet wins) | 30 hits → 26–29 unique |
| Context | Score sort + `MAX_SOURCES = 18` | Drops the weakest ~35% of hits |
| Context | `SNIPPET_CHARS = 350` (avg raw 1,731) | **~80% of snippet text removed** |
| Context | *Combined:* | **prompt 5,170 → ~3,200 tokens (−38%)** |
| Synthesis | `reasoning_effort: "low"` | **completion 3,072 → ~1,900 tokens (−38%)** |
| Synthesis | Schema min/max + word caps in prompt | Bounds output length structurally |
| Synthesis | Server-authored `sources` array | Model never re-emits 18 URLs it could corrupt |
| Synthesis | Worked counter-example for comparisons | Fixed directionally-backwards multiple claims |
| Render | Zero LLM calls; server components by default | Whole report costs 0 tokens, 0 JS for 7 of 8 components |
| Render | `next/font` self-hosted, CSS variables | No external font request, no FOUT |

Net measured: **9,056 tokens / 17.8s → 5,450–5,866 tokens / 9.0–16.5s** for the same
question, with *better* answer quality (current-period data, correct comparisons).

## 8. Failure model

| Failure | Where caught | Surfaced as |
|---|---|---|
| Missing API key | `callGroq` / `searchAngle` | 502, stage-tagged |
| Groq 4xx/5xx (e.g. model retired, 413 rate cap) | `callGroq` `res.ok` | 502 with truncated upstream body |
| Plan not valid JSON / wrong shape | `parseJsonLoose` + Zod | 502 `stage:"plan"` |
| Some Tavily angles reject | `Promise.allSettled` | run continues, `warnings[]` in response |
| Too few angles survive (<2) | `ResearchFanoutError` | 502 `stage:"research"` |
| All hits unusable (0 sources) | `pipeline.ts` guard | 502 `stage:"research"` |
| Thesis fails validation | `safeParse` | 502 `stage:"synthesis"` with Zod issue messages |
| Any of the above | `pipeline.ts` catch | Transcript still written, with `error` field |

Two historical failures are kept in `transcripts/` on purpose: the Groq model retirement
(404) and the free-tier 8k-tokens/minute ceiling (413). They are the evidence behind the
model-tier and source-capping decisions.

## 9. Deployment topology

Single Vercel project. One dynamic route handler (`force-dynamic`, Node runtime,
`maxDuration = 300` set in both the route and `vercel.json`). Everything else is static
or server-rendered. Two secrets: `TAVILY_API_KEY`, `GROQ_API_KEY`. Deployment Protection
is off so the link is shareable, which is why the README carries a key-rotation note.

## 10. Known limitations

- **No streaming.** The user waits 9–17s behind a simulated progress bar.
- **Cache is per-instance.** The LRU lives in module scope, so it is lost on cold start and not shared between concurrent serverless instances. Best-effort by design — see §11.
- **JSON transcripts are still dev-only** — the Vercel filesystem is ephemeral. Langfuse
  now covers production runs (§12); the local JSON files remain the richer artifact.
- **No numeric verification at runtime.** The prompt argues the model into correct
  comparisons; nothing blocks a bad one before the note renders. The eval suite (§13)
  scores them afterwards — measurement, not a guardrail.
- **Source ranking is relevance-only.** `lib/sources.ts` sorts on Tavily's score with no
  domain prior and no per-angle quota. `thesis/source-utilisation` measures the cost:
  roughly half the 18 curated sources are never cited. Known, measured, unfixed.
- **Tavily scores are not globally comparable.** Each score is relevance within its own
  angle query, so ranking the merged pool on them mixes several scales.

## 11. Caching and storage — current position

**Implemented: two in-process LRU layers (`lib/cache.ts`). Not implemented: durable storage.**

| Layer | Key | Size / TTL | Why there |
|---|---|---|---|
| Thesis cache (`route.ts`) | normalized question | 50 / 1h | Repeat question costs nothing at all |
| Angle cache (`tavily.ts`) | Tavily query string | 200 / 1h | Higher hit rate — different questions about one company share angles |

Both are module-scope, so they are shared across requests on a warm instance and lost on
cold start. That is a deliberate trade: zero infrastructure, zero secrets, and no way for
the cache to fail a request. Two rules keep it honest — **degraded runs are never cached**
(one Tavily blip must not become an hour of half-researched output), and **cache hits are
labelled in the UI** rather than passed off as fresh research. `RESEARCH_CACHE=0` disables
both.

The reasoning behind the shape:

- **A response cache is credit protection, not a speed feature.** The deployment is
  public with Deployment Protection off, so anyone with the link spends the free-tier
  Tavily/Groq budget. At ~12 Tavily credits per run (6 angles at advanced depth) against
  1,000/month free, that budget is roughly 80 runs. That — not latency — is the argument.
- **Cache hit rate depends entirely on the key.** Across the seven recorded runs, 4 of 7
  were repeats of a previous question (3 unique questions). That ratio reflects the three
  hardcoded example buttons in `QuestionForm`, which concentrate real demo traffic onto a
  handful of exact strings. On open free-text traffic, a normalized-string key would hit
  far less often.
- **Financial theses expire.** A short TTL (hours, not days) is mandatory, which caps the
  achievable hit rate regardless of key design.
- **Durable storage's strongest justification here is observability, not caching.**
  Transcripts are disabled on Vercel (ephemeral FS), so production runs currently leave
  no trace beyond `console.error`. Persisting them is what would make prod quality
  measurable — the same way the local transcripts made the §7 optimizations measurable.

Staging: **in-process LRU (done)** → shared Redis + rate limit (once the link is genuinely
public, and the rate limit matters more than the cache) → durable transcript store (once
prod quality needs measuring). A relational schema over theses stays overkill until
something actually reads it.

## 12. Observability in production (`lib/observability.ts`)

The JSON transcript cannot be written on Vercel, so production runs previously left no
trace. Langfuse now covers them — but through an unusual integration shape worth stating
plainly: **the trace is emitted by replaying the finished transcript, not by threading
SDK calls through the pipeline.**

The pipeline already records everything a tracer would capture. Instrumenting it a second
time would duplicate that work and put a vendor SDK on the hot path. Replaying instead
buys three things:

- exactly one integration point — `lib/pipeline.ts` has no vendor import at all
- failed runs are traced too, because the transcript is finalized on both paths
- Langfuse cannot slow down or break research; the worst case is a missing trace

Trace shape (one trace per run, id = the transcript's `runId`, so a Langfuse trace and a
local `transcripts/*.json` file match one-to-one):

```
TRACE  research-run            tags: [ok|error, degraded?, TICKER]
├─ GENERATION  plan            gpt-oss-20b   · prompts, response, token usage
├─ SPAN        research
│  ├─ SPAN  angle:1 … angle:6  query, results, cached?, attempts, ERROR level on failure
│  └─ (output: raw hits, cited sources, failures)
└─ GENERATION  synthesis       gpt-oss-120b  · prompts, response, token usage
```

Three operational details that decide whether this works at all:

1. **Flushing.** Serverless functions freeze the moment the handler returns, so batched
   events are lost unless flushed — the classic "works locally, records nothing in prod"
   failure. The route schedules tracing via `after()` from `next/server`, which keeps the
   function alive past the response, so the flush costs the user no latency.
2. **Bounded.** The flush races a 2.5s timeout. `after` work still counts against
   `maxDuration`, so a Langfuse outage must not sit there consuming the budget.
3. **Optional by default.** With no `LANGFUSE_*` keys the module no-ops permanently after
   one check, and the app behaves exactly as before. `LANGFUSE_TRACING=0` disables it even
   when keys are present.
4. **One event per observation.** Each span and generation is written complete, with both
   `startTime` and `endTime`, rather than as a create/end pair. The SDK batches events
   without preserving call order, so a create landing after its own update silently
   flattens the observation to zero duration.

Langfuse was chosen over LangSmith mainly for fit: a plain TS SDK with no framework
gravity, open source and self-hostable. The v5 OpenTelemetry SDK (`@langfuse/tracing`)
is the eventual upgrade path; v3's explicit `flushAsync()` is a better match for a
two-call pipeline on serverless.


---

## 13. Evaluation

Observability and evaluation share one artifact. The `RunTranscript` written for every
run (§12) is also the eval fixture, so quality can be scored offline — no keys, no
mocking, no re-running the model — and the full history scores in about a second.

Three layers, cheapest first:

| Layer | What it catches | Cost |
|---|---|---|
| **Zod validation**, inline in the pipeline | Malformed output. Fatal to the run by design: a thesis that fails `ThesisSchema` is never rendered. | free |
| **18 deterministic scorers**, `evals/scorers.ts` | Everything countable: literal dates in queries, undated price hits, duplicate sources, dangling or missing citations, style-limit breaches, mixed currencies, figures that appear in no cited source. | free, ~1s |
| **3 model-graded scorers**, `evals/judge.ts` | What a rule cannot read: is each cited claim actually supported, does every numeric comparison point the right way, does the note answer the question that was asked. | one Groq call per run |

Each scorer carries a threshold and `npm run eval` exits non-zero when a mean falls
below it, so the suite gates a prompt change or a model swap rather than merely
describing one. Scorers are written against properties the system already promises —
a prompt rule, a schema constraint, a retrieval decision — which is what keeps the
suite from drifting into measuring whatever is easy to measure.

The deterministic and model-graded layers deliberately overlap on grounding. They fail
differently, and on the most recent run three scorers independently caught the same
fabricated price target — a claim of *"$1,200 target, ~33% upside"* cited to a page whose
body says $1,011.88 and 12.13%:

```
thesis/number-provenance    catalysts[2]: "1200" not in sources [17]
judge/groundedness          catalysts[2] unsupported: snippet shows $1,011.88, not $1,200
judge/comparison-direction  catalysts[2] incorrect: $1,200 target vs $902.38 price
```

That is the argument for keeping the layers overlapping rather than deduplicating them.

A worked run, with the report and this finding, is in the
[README](../README.md#evals). See also [LLD §6.2](./LLD.md#62-evals-evals) for the
measurement decisions and [evals/README.md](../evals/README.md) for the full scorer table.
