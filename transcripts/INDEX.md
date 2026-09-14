# Research Run Transcripts

One JSON file per research run: both Groq prompts and their raw responses, every
Tavily query and its results, per-call token usage and timings, the Zod validation
outcome, and the final thesis. This is the full agent trace — nothing is summarised.

Filenames are `<ISO timestamp>_<question slug>.json`. The `runId` inside each file
is also the Langfuse trace id, so a file and a trace line up one-to-one.

| # | Question | Result | Tokens | Time | Cached angles |
|---|---|---|---|---|---|
| 1 | Is Nvidia (NVDA) a buy given current datacenter capex  | **FAILED** — Planning call failed: Groq API error 404 | 0 | 0.1s | — |
| 2 | Is Nvidia (NVDA) a buy given current datacenter capex  | Nvidia (NVDA) — Buy | 9,056 | 17.8s | — |
| 3 | Is Nvidia (NVDA) a buy given current datacenter capex  | **FAILED** — Synthesis call failed: Groq API error 413 | 550 | 5.3s | — |
| 4 | Is Nvidia (NVDA) a buy given current datacenter capex  | Nvidia (NVDA) — Buy | 5,866 | 16.5s | — |
| 5 | How does Costco (COST) membership model support its va | Costco Wholesale Corporation (COST) — Buy | 5,645 | 10.0s | — |
| 6 | What is the bear case on Palantir (PLTR) at its curren | Palantir Technologies (PLTR) — Hold | 5,450 | 9.0s | — |
| 7 | What is the bear case on Palantir (PLTR) at its curren | Palantir Technologies (PLTR) — Hold | 5,791 | 13.4s | — |
| 8 | Is Nvidia (NVDA) a buy given current datacenter capex  | Nvidia (NVDA) — Buy | 6,070 | 11.4s | — |
| 9 | What is the bear case on Nvidia (NVDA) at current valu | Nvidia (NVDA) — Hold | 5,620 | 10.2s | 1/6 |
| 10 | Is Costco (COST) a buy right now? | **FAILED** — Research search failed: Only 0 of 6 research angles succee | 670 | 1.6s | — |
| 11 | Is Costco (COST) a buy right now? | **FAILED** — Research search failed: Only 0 of 6 research angles succee | 638 | 1.3s | — |
| 12 | How does Costco (COST) membership model support its va | Costco Wholesale Corporation (COST) — Buy | 5,712 | 11.5s | — |
| 13 | What is the bull case on AMD (AMD) in AI accelerators? | Advanced Micro Devices (AMD) — Buy | 5,670 | 9.6s | — |
| 14 | Is Broadcom (AVGO) attractive at its current multiple? | Broadcom Inc. (AVGO) — Buy | 5,665 | 9.6s | — |

## Reading these

- **10 successful, 4 failed.** The failures are kept deliberately — each
  documents a real constraint rather than a mistake:
  - #1 Groq retired the Llama 3.x models mid-build (404), forcing the move to the GPT-OSS tier.
  - #3 the free tier's 8k tokens/minute ceiling (413), which is why the source list is capped
    at 18 and snippets trimmed to 350 chars.
  - #10, #11 a deliberately invalid Tavily key, exercising the resilient fan-out: all six
    angles fail with 401, the survivor floor trips, and the run stops in ~1.5s rather than
    retrying a permanent error.
- **Median successful run: 5,712 tokens.** Roughly 3.5k prompt (18 deduped, trimmed
  sources) plus 2k completion from the single synthesis call.
- **#2 vs #4** is the optimization commit: same question, 9,056 → 5,866 tokens, with better
  output quality. Prompt side from capping sources, completion side from `reasoning_effort: "low"`.
- **#8 onward** use year/quarter search labels; earlier runs pasted full ISO dates into queries
  (`"Palantir PLTR bear case risks 2026-09-13"`), which is noise to a search engine.
- Only one LLM call produces content. The report's layout comes from rendering the validated
  JSON, not from asking a model to format prose.

Transcripts are written on local `npm run dev` runs only — Vercel's filesystem is ephemeral,
so production runs are traced to Langfuse instead.
