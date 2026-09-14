# Thesis — Deep Research for Investors

Ask an investing question, get a cited equity research thesis rendered as a clean research note.

**Live:** https://deep-research-invest.vercel.app (public — no login required)

**[Build writeup](./writeup.md)** — what the system does, and the optimization made at
each stage with the measurement behind it.

## Demo

A live run against production — question in, progress through the three stages, then the
rendered note with its cited footnotes:

![Running a research question end to end](./docs/media/app-demo.gif)

The same pipeline seen from Langfuse: one trace per run, the two Groq generations with
their prompts and token usage, and every search as its own span.

![The Langfuse trace for a run](./docs/media/langfuse-trace.gif)

> Deployment Protection is off so the link can be shared freely. Each run spends
> roughly 12 Tavily credits against a 1,000/month free tier — about 80 runs — so the
> URL is a metered resource. Two things blunt that: identical questions are served
> from an in-process cache without touching either API, and the run itself is capped
> at 6 searches.
>
> Rotate `TAVILY_API_KEY` and `GROQ_API_KEY` once the demo window closes. To gate it
> again: Project Settings → Deployment Protection → All Deployments, or generate a
> Protection Bypass secret to keep it shareable without granting team access.

## How it works

```
question
  → cache lookup         repeat question → served instantly, no API calls
  → Groq gpt-oss-20b     identify company/ticker + 4-6 research angles
  → Tavily × N angles    concurrent search (Promise.allSettled), time-boxed to 1 year
                         12s per-angle timeout, 1 retry on 429/5xx, survives partial failure
  → dedupe + number      top 18 sources, snippets trimmed to 350 chars
  → Groq gpt-oss-120b    ONE synthesis call → structured thesis JSON
  → React/CSS            deterministic render, no further LLM calls
  → Langfuse             the finished transcript is replayed as a trace
```

A typical run costs ~5,800 tokens and takes 9-17 seconds.

Token efficiency is architectural: only one LLM call produces content. The report's
formatting comes from rendering structured JSON, not from asking a model to write prose.
Source snippets are capped and deduped before they reach the synthesis prompt, and the
schema itself bounds output length (bullet counts, word limits).

## Setup

1. Get free API keys (no credit card required for either):
   - Tavily — https://tavily.com (1,000 credits/month free)
   - Groq — https://console.groq.com (free tier)
2. `cp .env.example .env.local` and fill in both keys.
3. `npm install && npm run dev` → http://localhost:3000

Set `MOCK_RESEARCH=1` to run the UI against a fixture instead of live APIs (useful for
demoing the layout without spending credits).

## Transcripts

Every local run writes a full transcript to `transcripts/<timestamp>_<slug>.json`:
both Groq prompts and raw responses, every Tavily query and result, per-call token
usage and timings, and the final validated thesis.

Known limitation: transcript writing is disabled on Vercel (`process.env.VERCEL`),
because the serverless filesystem is ephemeral. Transcript review happens against
local `npm run dev` runs.

## Tracing (optional)

Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to send each run to
[Langfuse](https://langfuse.com) as a trace — both prompts and responses, token usage,
and every search as its own span, with failed angles at ERROR level. This is what covers
**production** runs, where the JSON transcript cannot be written.

The trace is built by replaying the finished transcript, so the pipeline itself has no
vendor import, and a Langfuse outage cannot slow down or break research. Without the keys
tracing no-ops entirely; `LANGFUSE_TRACING=0` disables it even when keys are set.

Trace ids match the local transcript `runId`, so a trace and a `transcripts/*.json` file
can be lined up one-to-one.

## Deploy (Vercel free tier)

1. Push to a Git remote, import the repo at vercel.com, or run `npx vercel`.
2. Set `TAVILY_API_KEY` and `GROQ_API_KEY` in Project Settings → Environment Variables.
3. Confirm Fluid Compute is enabled (Project Settings → Functions). Without it, Hobby
   caps functions at 60s and a slow research run will 504; with it, the limit is 300s,
   which `app/api/research/route.ts` requests via `export const maxDuration = 300`.
