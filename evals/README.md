# Evals

Offline scoring for the research agent. Eighteen deterministic scorers plus three
model-graded ones, run over the committed run transcripts or over fresh live runs.

```bash
npm run eval                            # score every committed transcript, no API calls
npm run eval -- --since 2026-09-14T17:00  # only runs made after a given fix landed
npm run eval:judge                      # ...and grade each one with the LLM judge
npm run eval:live                       # run the golden question set for real, then score it
npm run eval -- --help
```

Exits non-zero when any scorer's mean falls below its threshold, so `npm run eval`
can gate a prompt change or a model swap in CI.

## Why it is shaped this way

The pipeline already writes a complete `RunTranscript` for every run — both prompts,
both raw responses, every Tavily query and its hits, retries, cache hits, the Zod
outcome, the final thesis. That artifact is the eval fixture. Scoring reads it and
needs no API keys, no mocking and no re-running of the model, which is why the
deterministic half of this suite finishes in about a second over the whole history.

Every scorer checks a property the pipeline actually promises somewhere — a prompt
rule, a schema constraint, or a retrieval decision. Nothing is measured because it
was easy to measure.

The judge is kept separate and opt-in. It costs Groq calls, it shares the free tier's
8k tokens/minute ceiling, and a grader is itself a model that can be wrong — so the
deterministic suite is the one that belongs in CI, and the judge is the one you run
when changing a prompt.

**Grounding is scored against the truncated snippets the model was actually shown**,
parsed back out of the synthesis prompt, not against the full Tavily payload and not
against the live web. Judging a claim against text the writer never saw scores the
wrong thing.

## Scorers

### Plan stage

| id | what a low score means |
|---|---|
| `plan/schema-valid` | Planner output did not match `ResearchPlanSchema`. Fatal to the run. |
| `plan/no-literal-dates` | A query carries a full ISO date. A search engine reads `2026-09-13` as a literal token and it dilutes the real terms. |
| `plan/recency-anchor` | A query anchors on a year older than last year. |
| `plan/names-company` | A query names neither the company nor the ticker — it will retrieve the wrong company. |
| `plan/price-angle-present` | No angle classified as a price angle, so nothing routes to the week-wide news search that returns dated results. |
| `plan/expected-ticker` | The planner resolved a different company than the golden case expected. |

### Retrieval stage

| id | what a low score means |
|---|---|
| `retrieval/angle-success` | Angles came back empty. The pipeline tolerates partial failure, so this degrades quietly — which is why it is measured. |
| `retrieval/source-dedup` | The same URL occupies two numbered slots, letting one page look like two agreeing sources. |
| `retrieval/price-source-dated` | Price-angle hits arrived undated. This is how a seven-month-old quote reaches synthesis looking current. |

### Synthesis stage

| id | what a low score means |
|---|---|
| `thesis/schema-valid` | Synthesis output did not match `ThesisSchema`. Fatal to the run. |
| `thesis/citation-validity` | A `sourceId` points at a source that does not exist. |
| `thesis/citation-coverage` | A claim carries no citation, making it indistinguishable from an invented one. |
| `thesis/no-inline-citations` | A text field contains a written-out `[4]`, doubling with the rendered footnote. |
| `thesis/style-limits` | Prompt length rules broken: bullets ≤ 25 words, summary 60–90 words, `valuationSummary` 2–4 sentences, array cardinalities. |
| `thesis/price-single-quote` | `priceContext` mixes currencies, or `exchange` lists two venues. Dual-listed names break here. |
| `thesis/price-dated` | The price quote is undated or uncited, so it reads as current whatever its age. |
| `thesis/number-provenance` | A figure in a cited claim appears in none of the sources that claim cites. |
| `thesis/source-utilisation` | Synthesis ignored most of what retrieval paid for — the ranking is surfacing the wrong 18 pages. |

### Model-graded (`--judge`)

| id | what a low score means |
|---|---|
| `judge/groundedness` | A cited claim is not supported by the snippet it cites. Supported 1, partial 0.5, unsupported 0. |
| `judge/comparison-direction` | A numeric comparison points the wrong way. Guards the exact failure the prompt was written against: *"P/E of 149 is far above the 3-year average of 202"*. |
| `judge/answers-question` | The note answers a generic version of the question rather than the one asked. |

`thesis/number-provenance` and `judge/groundedness` overlap on purpose: one is a
counter, the other a reader, and they fail differently. Both independently caught
the same hallucinated price target in the most recent run — a claim of *"$1,200
target, ~33% upside"* cited to a page whose body says $1,011.88 and 12.13%.

## Reading the numbers

`npm run eval` with no filter scores the **entire committed history**, which spans
the whole build — including runs made before the prompt and retrieval fixes those
runs motivated. It reports roughly:

```
plan/no-literal-dates          0.89    the fix that added stripLiteralDates
retrieval/price-source-dated   0.09    the fix that routed price angles to news search
thesis/price-dated             0.14    the fix that made priceContext a cited, dated field
thesis/number-provenance       0.67
```

Those are the pre-fix runs scoring as pre-fix runs. Pass `--since` to score a single
generation of the pipeline: `--since 2026-09-14T17:00` scores the one run made after
every fix landed, and everything passes except `judge/groundedness` at 0.80.

Two known honest limits:

- **Derived figures.** A YoY the model computed from two absolute numbers is
  traceable to no snippet, so `thesis/number-provenance` has a real floor below 1.0.
  The threshold is 0.85, not 1.0, for that reason.
- **One run is not a measurement.** The per-generation slice above is a single run.
  `npm run eval:live` exists to produce a full golden-set generation in one go.

## Adding a case or a scorer

A new golden question goes in `cases.ts` with a `rationale` saying which failure mode
it covers. A new scorer is an entry in `SCORERS` in `scorers.ts`: give it a threshold
you are willing to have fail the build, and write `describes` for the person reading a
red line in CI, not for yourself.

`npm run eval:live` writes a transcript per case into `transcripts/`, the same as any
local run. Delete them or keep them — the fixture suite will score whatever is there.
