# Thesis — Build Writeup

**Live:** https://deep-research-invest.vercel.app · **Source:** [GitHub](https://github.com/visesh68/deep-research-invest)

A summary of what this system does, how it is put together, and the optimization made at
each stage — with the measurement that justified it. Companion documents:
[HLD.md](./docs/HLD.md) for architecture, [LLD.md](./docs/LLD.md) for function-level
detail, [evals/README.md](./evals/README.md) for how quality is scored,
[transcripts/](./transcripts) for the raw runs the numbers come from.

---

## 1. Summary

One input: a free-text investing question. One output: a cited equity research note —
rating, thesis summary, bull and bear columns, financials table, valuation, catalysts,
risks, numbered source footnotes.

Between them sit three stages behind a single POST request:

```
question
  → cache lookup       repeat question → served instantly, no API calls
  → PLAN               Groq gpt-oss-20b  · identify company/ticker + 4-6 research angles
  → RESEARCH           Tavily × N        · concurrent search, partial-failure tolerant
  → curate             dedupe → rank → cap at 18 sources → trim snippets
  → SYNTHESIZE         Groq gpt-oss-120b · ONE call → structured thesis JSON
  → render             React/CSS         · deterministic, zero LLM calls
  → trace              Langfuse          · finished transcript replayed as a trace
```

A typical run costs **~5,700 tokens and 9–17 seconds**. There is no database, no job
queue, no auth, and no streaming protocol — a deliberate constraint, not an omission.

**The single decision that shapes everything else: exactly one LLM call produces
content.** The plan call emits search queries, not prose. Every heading, column, table
cell and citation superscript in the final report comes from React rendering validated
JSON. The alternative — per-section generation, or an LLM formatting pass — would
multiply completion tokens by roughly the section count and reintroduce every
formatting-drift bug that a Zod schema currently makes impossible. This saving never
appears in a before/after table because it was never paid.

A run against production — the question, the three stages, and the rendered note:

![Running a research question end to end](./docs/media/app-demo.gif)

---

## 2. Results

Same question, before and after the optimization pass:

|  | prompt | completion | total | wall |
|---|---|---|---|---|
| Before | 5,170 | 3,072 | **9,056** | 17.8s |
| After | 2,962 | 2,341 | **5,866** | 16.5s |
| After (COST) | 3,056 | 2,027 | 5,645 | 10.0s |
| After (PLTR) | 3,231 | 1,653 | **5,450** | 9.0s |

**−35 to −40% tokens and roughly half the latency, with better answer quality** —
current-period figures and correct comparisons, not just fewer tokens. Median across 11
successful recorded runs: **5,712 tokens**.

Quality improving alongside cost is not a coincidence. Most of the prompt-side saving
came from *removing weak sources*, and weak sources were also what produced vague and
poorly-grounded claims.

---

## 3. Optimizations by stage

### Stage 0 — Transport (`app/api/research/route.ts`)

| Optimization | Effect |
|---|---|
| Length gate, 4–500 chars, before any paid call | Junk input costs nothing |
| In-process LRU thesis cache (50 entries, 1h TTL) | Repeat question: **11.5s → 5.5ms**, 0 tokens, 0 credits |
| `MOCK_RESEARCH=1` fixture behind a dynamic `import()` | Demo the UI at zero credits; the fixture never enters the production bundle |
| `maxDuration = 300` + Fluid Compute | Prevents a 504 against the 60s Hobby cap |

**The cache is credit protection, not a speed feature.** The deployment is public with
Deployment Protection off, so anyone with the link spends the free-tier budget. At ~12
Tavily credits per run against 1,000/month, that budget is about 80 runs — that, not
latency, is the argument for caching.

Two rules keep it honest: **degraded runs are never cached** (one Tavily blip must not
become an hour of half-researched output), and **cache hits are labelled in the UI**
rather than passed off as fresh research.

### Stage 1 — Plan (`lib/prompts.ts`, Groq `gpt-oss-20b`)

| Optimization | Effect |
|---|---|
| Smallest model for extraction-shaped work | ~560 tokens, 0.6–1.4s |
| `angles` capped at 6 by schema | Hard ceiling on search credits and stage-2 latency |
| Year/quarter labels instead of ISO dates | Removed noise tokens from every query |
| `stripLiteralDates` regex backstop | Deterministic guard where a prompt rule can drift |

**Cheap model for cheap work.** Planning is entity extraction plus query writing; it does
not need the frontier tier. The 20b model does it in under a second.

The date handling is worth singling out as a general lesson. Injecting today's date
produced queries like `"Palantir PLTR bear case risks 2026-09-13"` — a search engine reads
that as a literal token, so it diluted the real search terms. The fix was to derive the
year and quarter in code and hand *those* to the model, removing the temptation to paste a
raw date. The regex backstop exists because **prompt instructions drift between model
versions and a regex does not** — a principle applied again in stage 2.

### Stage 2 — Research (`lib/tavily.ts`)

| Optimization | Effect |
|---|---|
| `Promise.allSettled` fan-out over 6 angles | **19.7–27.7s serial → 4.1–9.6s wall (~4×)** |
| Partial-failure tolerance + survivor floor (≥2) | One dead angle degrades the run instead of killing it |
| 12s per-angle timeout + 1 jittered retry on 429/5xx | Worst case bounded at ~24s, not the 300s ceiling |
| No retry on permanent errors (401/4xx) | A bad key fails in ~1.5s instead of retrying twice |
| In-process LRU angle cache (200 entries, 1h TTL) | Angles repeat across questions more than whole questions do |
| Per-angle search tiers (see below) | Price data fresh to the week; fundamentals still year-wide |
| `include_raw_content: false`, `max_results: 5` | Smaller payloads, fewer credits |

**Partial-failure tolerance was a correctness fix, not a robustness nicety.** A single
dead angle used to abort a run that five healthy angles could have carried — after the
planning call had already been paid for. The run now degrades and only gives up below two
surviving angles, because a thesis built on one search would look confident and be
worthless.

**Per-angle search tiers** are the most recent change and came directly from reading a
trace. A production run returned:

> *"Shares trading around $946, above 20-day SMA of €1,174 (Feb 2026) indicating momentum"*

Four defects in one line: two currencies compared as one series, a backwards comparison
($946 is *below* €1,174), a seven-month-old figure presented as current momentum, and no
citation. The root cause was structural rather than a model slip:

1. Tavily's `published_date` was discarded in the response mapper.
2. The field is only returned on news-topic searches, so it was never even requested.
3. A single `time_range: "year"` let a February price article rank top on relevance in
   September, with nothing marking it stale.

So the model was instructed to label figures with their period while being structurally
unable to date a price. Price angles now search the news topic over a one-week window and
carry an ISO publish date into the source block; fundamentals angles are deliberately
unchanged, because news search trades away the filings and IR pages they depend on. Angles
are classified by regex rather than by asking the planner, since the angle id is free-form
model output.

### Stage 2.5 — Context curation (`lib/sources.ts`)

| Optimization | Effect |
|---|---|
| URL normalization + dedupe, longest snippet wins | 30 hits → 26–29 unique |
| Score sort **before** the cap | Drops the weakest ~35% rather than an arbitrary 35% |
| `MAX_SOURCES = 18` | Bounds the prompt regardless of fan-out size |
| `SNIPPET_CHARS = 350` (average raw snippet: 1,731) | **~80% of snippet text removed** |
| *Combined* | **prompt 5,170 → ~3,200 tokens (−38%)** |

**The context window is curated, not dumped.** Stage 2 produces roughly 52k characters of
raw snippet text; stage 3 receives about 6.3k. This is the single largest measured saving
in the system.

The ordering matters more than it looks: sorting by relevance score *before* slicing to 18
is what makes the cap a quality improvement rather than arbitrary truncation.

### Stage 3 — Synthesis (`lib/prompts.ts`, Groq `gpt-oss-120b`)

| Optimization | Effect |
|---|---|
| `reasoning_effort: "low"` | **completion 3,072 → ~1,900 tokens (−38%)** |
| Schema `min`/`max` on every array + word caps in prompt | Output length bounded structurally, not by asking nicely |
| Server-authored `sources` array | The model never re-emits 18 URLs it could corrupt |
| Worked wrong/right counter-example for comparisons | Fixed directionally-backwards multiple claims |
| `priceContext` as a cited, dated claim | Price quotes are now traceable like every other figure |

**Schemas are the guardrail, not retries.** There is no repair loop. `ThesisSchema`'s
bounds (`bullCase` 3–5, `catalysts` 2–4, …) are *the output token budget expressed as a
type*, and validation failure is a stage-tagged 502 with the Zod messages attached —
honest, and free when things go right.

One lesson from the price fix is worth stating on its own: **making data available is not
the same as getting it used.** After publish dates were added to the source block, the
model still returned an undated price — it had the dates in front of it and ignored them.
Only when the prompt explicitly required one listing, one currency, and a date taken from
the source's published marker did the output change:

```
before  "Shares trading around $946, above 20-day SMA of €1,174 (Feb 2026)..."   NASDAQ/XETRA
after   "$902.38 as of 2026-09-11"  → cites source [17]                          NASDAQ
```

Retrieval fixes made the right answer reachable; the prompt rule made it get chosen. Both
were necessary and neither was sufficient.

### Stage 4 — Render (`components/*`)

| Optimization | Effect |
|---|---|
| Zero LLM calls | The entire report costs 0 tokens |
| Server components by default | 7 of 8 components ship no JavaScript |
| `next/font` self-hosted + CSS variables | No external font request, no FOUT |
| Progress driven by a fixed timing table | Honest UX feedback without SSE plumbing |

Because the renderer consumes a *validated* `Thesis`, every component is total: no loading
states, no error branches, no null guards beyond genuinely optional fields.

---

## 4. Observability — what made the rest possible

Every local run writes a full transcript to `transcripts/<timestamp>_<slug>.json`: both
prompts, both raw responses, every query and hit, per-call usage and timings, and the
validation outcome. **That artifact is why the numbers in this document are measurements
rather than estimates.**

Production runs cannot write those files — Vercel's filesystem is ephemeral — so Langfuse
covers them, through an integration shape worth stating plainly: **the trace is emitted by
replaying the finished transcript, not by threading SDK calls through the pipeline.** That
buys three things:

- exactly one integration point — `lib/pipeline.ts` has no vendor import at all
- failed runs are traced too, because the transcript is finalized on both paths
- Langfuse cannot slow down or break research; the worst case is a missing trace

Three details decide whether this works at all. **Flushing:** serverless functions freeze
the instant the handler returns, so batched events are lost unless flushed — the classic
"works locally, records nothing in production" failure. Tracing is scheduled via `after()`
from `next/server`, which keeps the function alive past the response, so the flush costs
the user no latency. **Bounded:** that flush races a 2.5s timeout, because `after` work
still counts against `maxDuration` and a vendor outage must not consume the budget.
**One event per observation:** each span is written complete with both `startTime` and
`endTime` rather than as a create/end pair, because the SDK batches without preserving
order and a create landing after its own update silently flattens the observation to zero
duration.

Trace ids match the local transcript `runId`, so a trace and a JSON file line up
one-to-one. The trace below is run #15 in [`transcripts/`](./transcripts) — the same run,
readable as raw JSON in the repo and as a trace tree in Langfuse:

![The Langfuse trace for a run](./docs/media/langfuse-trace.gif)

---

## 5. Evals — scoring what the observability made visible

A transcript makes a run *inspectable*. It does not make quality *measurable* — reading
fifteen JSON files by hand is not a measurement. So the same artifact is reused as an eval
fixture: because it already holds both prompts, both raw responses and every search
result, scoring a run needs no API keys, no mocking and no re-execution. The whole
committed history scores in about a second.

```bash
npm run eval          # score every committed transcript — no API calls
npm run eval:judge    # ...and grade each one with an LLM judge
npm run eval:live     # run the golden question set for real, then score it
```

Three layers, cheapest first: **Zod validation** inline in the pipeline, fatal to the run
by design; **18 deterministic scorers** covering everything countable; **3 model-graded
scorers** for what a rule cannot read. Each carries a threshold and `npm run eval` exits
non-zero below it, so the suite gates a prompt change rather than merely describing one.

Every scorer guards a property some part of this document already claims.
`plan/no-literal-dates` guards the fix in Stage 1. `retrieval/price-source-dated` guards
the news-topic routing in Stage 2. `thesis/number-provenance` and `thesis/citation-coverage`
guard the citation rules in Stage 3. That constraint is what keeps a suite from drifting
into measuring whatever is easiest to measure.

![The eval suite scoring a run](./docs/media/eval-run.gif)

**What it found on the first honest run.** Scoring the most recent transcript with the
judge enabled, everything passes except `judge/comparison-direction` — and three different
scorers converge on one defect:

```
thesis/number-provenance    catalysts[2]: "1200" not in sources [17]
judge/groundedness          catalysts[2] unsupported: snippet shows $1,011.88, not $1,200
judge/comparison-direction  catalysts[2] incorrect: $1,200 target vs $902.38 price
```

The note claimed a *"$1,200 price target, ~33% upside"*. The cited page's **headline** reads
"A $1,200 Target Comes Into Focus"; its body gives $1,011.88 and 12.13%. A counter, a
reader and a comparison check each caught it from a different direction — which is the
argument for keeping the deterministic and model-graded layers overlapping rather than
deduplicating them.

The second finding is about ranking: `thesis/source-utilisation` sits at 0.47–0.56, meaning
roughly half the 18 curated sources are never cited. Sources are ranked on Tavily's
relevance score alone — no domain prior, no per-angle quota — and for Costco that put an
Instagram post and `companieshistory.com` in the context window. That is a real cost
(prompt tokens spent on pages the model ignores) that the optimization pass in §3 did not
see, because nothing was measuring it.

Three measurement decisions, each of which was wrong first:

- **Grounding is checked against the truncated snippets parsed back out of the synthesis
  prompt** — exactly what the model was shown, 350-char cut and all. An early judge pass
  trimmed them further and marked genuinely supported claims unsupported.
- **Source titles are excluded from the provenance pool.** Counting the title as support
  scored the fabricated $1,200 target as grounded — the headline was the only place it
  appeared.
- **Numbers match numerically with a rounding allowance, not by string prefix.** Prefix
  matching passed "~33% upside" against a snippet whose only `3` came from "Q3 fiscal 2026".

**Honest limit:** run unfiltered, `npm run eval` scores the entire build history, including
runs made before the fixes those very runs motivated, so several scorers read low by
construction (`retrieval/price-source-dated` 0.09, `thesis/price-dated` 0.14). `--since`
scores one generation. The suite is a regression gate, not a leaderboard — and one run is
not a measurement, which is what `npm run eval:live` exists for.

---

## 6. What the failures document

Four of the fifteen committed transcripts did not produce a thesis. They are kept on
purpose, because each one is the evidence behind a design decision:

| Run | What it documents |
|---|---|
| #1 | Groq retired the Llama 3.x models mid-build (404) — forced the move to the GPT-OSS tier |
| #3 | The free tier's 8k tokens/minute ceiling (413) — why sources are capped at 18 and snippets at 350 chars |
| #10, #11 | A deliberately invalid Tavily key — all six angles 401, the survivor floor trips, the run stops in ~1.5s rather than retrying a permanent error |

Run #15 is the successful counterpart to #10 and #11: the same question with a valid key.
Read together they show both sides of the fan-out.

---

## 7. Honest limitations

- **No streaming.** The user waits 9–17s behind a simulated progress bar.
- **Cache is per-instance.** Module-scope LRU, lost on cold start, not shared between
  concurrent serverless instances. Best-effort by design.
- **JSON transcripts remain dev-only.** Langfuse covers production; the local files stay
  the richer artifact.
- **No numeric verification at runtime.** The prompt argues the model into correct
  comparisons; nothing blocks a bad one before the note renders. The eval suite catches
  them afterwards (§5) — which is measurement, not a guardrail. Arithmetic on extracted
  figures, inline, would be the guardrail.
- **Ranking is relevance-only.** Sources are ordered by Tavily's score with no domain
  prior and no per-angle quota, and `thesis/source-utilisation` says roughly half of them
  are never cited. Known, measured, unfixed.
- **Built for single-name listed equities.** The schema forces a ticker, a price, an
  exchange and P/E-style multiples. A question about a mutual fund or an index will be
  pushed through a shape that does not fit it and will still return `ok`.

The staging plan from here: in-process LRU (done) → shared Redis plus a rate limit, once
the link is genuinely public → a durable transcript store, once production quality needs
measuring. A relational schema over theses stays overkill until something actually reads
it.
