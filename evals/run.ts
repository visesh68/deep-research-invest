/**
 * Eval runner.
 *
 *   npm run eval              score every committed transcript (no API calls)
 *   npm run eval:judge        ...and grade each one with the LLM judge
 *   npm run eval:live         run the golden question set through the real
 *                             pipeline first, then score those runs
 *
 * Exits non-zero when any scorer's mean falls below its threshold, so this can
 * gate a prompt change or a model swap in CI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { RunTranscript } from "../lib/transcript.ts";
import { SCORERS, type ScoreResult } from "./scorers.ts";
import { JUDGE_SCORERS, judgeRun, type JudgeScorerId } from "./judge.ts";
import { CASES, type EvalCase } from "./cases.ts";

type Options = {
  live: boolean;
  judge: boolean;
  caseFilter?: string;
  limit?: number;
  jsonOut?: string;
  since?: string;
  delayMs: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = { live: false, judge: false, delayMs: 7000, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") opts.live = true;
    else if (a === "--judge") opts.judge = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--case") opts.caseFilter = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--json") opts.jsonOut = argv[++i];
    else if (a === "--since") opts.since = argv[++i];
    else if (a === "--delay") opts.delayMs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run eval -- [options]",
          "  --live          run the golden cases through the real pipeline (costs API credits)",
          "  --judge         add the LLM-as-judge scorers (costs Groq calls)",
          "  --case <id>     live mode: run one golden case",
          "  --limit <n>     cap the number of runs scored",
          "  --json <path>   write the full result set as JSON",
          "  --since <ISO>   fixture mode: score only runs started on or after this date",
          "  --delay <ms>    pause between judge calls (default 7000, for Groq's free tier)",
          "  --verbose       print every failure rather than the first three per scorer",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return opts;
}

type Subject = { label: string; transcript: RunTranscript; kase?: EvalCase };

async function loadFixtures(opts: Options): Promise<Subject[]> {
  const dir = path.join(process.cwd(), "transcripts");
  let files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  // Filenames lead with the ISO start time, so a lexical comparison is a date
  // comparison. `--since` exists because the committed transcripts span the
  // whole build: scoring a prompt fix against runs made before it landed
  // measures the history, not the pipeline as it stands.
  if (opts.since) files = files.filter((f) => f >= opts.since!.replace(/[:.]/g, "-"));
  const subjects: Subject[] = [];
  for (const f of files) {
    try {
      const t = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as RunTranscript;
      subjects.push({
        label: f.replace(/\.json$/, ""),
        transcript: t,
        // A fixture whose question matches a golden case inherits its
        // expectations, so ticker resolution is scored offline too.
        kase: CASES.find((c) => c.question === t.question),
      });
    } catch (err) {
      console.warn(`Skipping unreadable transcript ${f}: ${(err as Error).message}`);
    }
  }
  return opts.limit ? subjects.slice(0, opts.limit) : subjects;
}

async function runLive(opts: Options): Promise<Subject[]> {
  // Imported lazily: fixture mode must not need API keys in the environment.
  const { runPipeline } = await import("../lib/pipeline.ts");
  let cases = CASES;
  if (opts.caseFilter) cases = cases.filter((c) => c.id === opts.caseFilter);
  if (opts.limit) cases = cases.slice(0, opts.limit);
  if (cases.length === 0) throw new Error(`No golden case matched "${opts.caseFilter}"`);

  const subjects: Subject[] = [];
  for (const kase of cases) {
    process.stdout.write(`  running ${kase.id}… `);
    try {
      const { transcript } = await runPipeline(kase.question);
      console.log(`${transcript.thesis?.rating ?? "?"} · ${(transcript.totalMs / 1000).toFixed(1)}s`);
      subjects.push({ label: kase.id, transcript, kase });
    } catch (err) {
      // A failed run is still scoreable — every stage that completed before the
      // failure is in the transcript, and those scores are the diagnostic.
      const t = (err as { transcript?: RunTranscript }).transcript;
      console.log(`FAILED — ${(err as Error).message}`);
      if (t) subjects.push({ label: kase.id, transcript: t, kase });
    }
  }
  return subjects;
}

type Aggregate = {
  id: string;
  describes: string;
  threshold: number;
  scores: { label: string; result: ScoreResult }[];
};

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function bar(score: number): string {
  const filled = Math.round(score * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const subjects = opts.live
    ? (console.log(`Running ${opts.caseFilter ? 1 : CASES.length} golden case(s) live:`), await runLive(opts))
    : await loadFixtures(opts);

  if (subjects.length === 0) {
    console.error("Nothing to score.");
    process.exit(1);
  }

  const aggregates = new Map<string, Aggregate>();
  const record = (id: string, describes: string, threshold: number, label: string, result: ScoreResult) => {
    if (!aggregates.has(id)) aggregates.set(id, { id, describes, threshold, scores: [] });
    aggregates.get(id)!.scores.push({ label, result });
  };

  for (const s of subjects) {
    for (const scorer of SCORERS) {
      record(scorer.id, scorer.describes, scorer.threshold, s.label, scorer.run(s.transcript, s.kase));
    }
  }

  if (opts.judge) {
    const gradable = subjects.filter((s) => s.transcript.thesis);
    console.log(`\nGrading ${gradable.length} run(s) with the judge (${opts.delayMs}ms between calls):`);
    let judgeTokens = 0;
    for (const [i, s] of gradable.entries()) {
      // Sequential and paced on purpose: the judge shares Groq's free-tier
      // 8k tokens/minute budget with nothing, and a 429 mid-suite would score
      // as a missing grade rather than a bad note.
      if (i > 0 && opts.delayMs > 0) await new Promise((r) => setTimeout(r, opts.delayMs));
      process.stdout.write(`  ${s.label}… `);
      const outcome = await judgeRun(s.transcript);
      judgeTokens += outcome.tokens;
      console.log(outcome.error ? `error: ${outcome.error}` : outcome.results["judge/groundedness"].detail);
      for (const js of JUDGE_SCORERS) {
        record(js.id, js.describes, js.threshold, s.label, outcome.results[js.id as JudgeScorerId]);
      }
    }
    console.log(`  judge tokens: ${judgeTokens.toLocaleString()}`);
  }

  // ---- report
  console.log(`\n${"=".repeat(96)}`);
  console.log(`EVAL REPORT — ${subjects.length} run(s), ${opts.live ? "live" : "fixtures"}${opts.judge ? " + judge" : ""}`);
  console.log("=".repeat(96));
  console.log(
    `${"scorer".padEnd(32)}${"n".padStart(4)}  ${"score".padStart(6)}  ${"min".padStart(5)}  ${"".padEnd(12)}  status`,
  );
  console.log("-".repeat(96));

  let failed = 0;
  const failureReport: string[] = [];

  for (const agg of aggregates.values()) {
    const applicable = agg.scores.filter((s) => s.result.score !== null);
    if (applicable.length === 0) {
      console.log(`${agg.id.padEnd(32)}${"-".padStart(4)}  ${"n/a".padStart(6)}  ${agg.threshold.toFixed(2).padStart(5)}  ${"".padEnd(12)}  SKIP`);
      continue;
    }
    const m = mean(applicable.map((s) => s.result.score!));
    const pass = m >= agg.threshold - 1e-9;
    if (!pass) failed++;
    console.log(
      `${agg.id.padEnd(32)}${String(applicable.length).padStart(4)}  ${m.toFixed(3).padStart(6)}  ${agg.threshold.toFixed(2).padStart(5)}  ${bar(m).padEnd(12)}  ${pass ? "pass" : "FAIL"}`,
    );

    const offenders = agg.scores.filter((s) => s.result.failures.length > 0);
    if (offenders.length > 0) {
      const lines: string[] = [`\n${pass ? "·" : "✗"} ${agg.id} — ${agg.describes}`];
      for (const o of offenders) {
        const shown = opts.verbose ? o.result.failures : o.result.failures.slice(0, 3);
        lines.push(`  ${o.label} (${o.result.detail})`);
        for (const f of shown) lines.push(`    - ${f}`);
        if (o.result.failures.length > shown.length) {
          lines.push(`    - …${o.result.failures.length - shown.length} more (--verbose)`);
        }
      }
      failureReport.push(lines.join("\n"));
    }
  }

  if (failureReport.length > 0) {
    console.log(`\n${"-".repeat(96)}\nDETAIL`);
    console.log(failureReport.join("\n"));
  }

  if (opts.jsonOut) {
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: opts.live ? "live" : "fixtures",
      judge: opts.judge,
      runs: subjects.map((s) => ({ label: s.label, question: s.transcript.question, runId: s.transcript.runId })),
      scorers: [...aggregates.values()].map((agg) => {
        const applicable = agg.scores.filter((s) => s.result.score !== null);
        return {
          id: agg.id,
          threshold: agg.threshold,
          n: applicable.length,
          mean: applicable.length ? mean(applicable.map((s) => s.result.score!)) : null,
          perRun: agg.scores.map((s) => ({ label: s.label, ...s.result })),
        };
      }),
    };
    await fs.writeFile(opts.jsonOut, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${opts.jsonOut}`);
  }

  console.log(`\n${failed === 0 ? "All scorers met their thresholds." : `${failed} scorer(s) below threshold.`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
