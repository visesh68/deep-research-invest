/**
 * Model-graded scorers — the checks that need reading comprehension rather than
 * a regex.
 *
 * Three judgements per run, in ONE call: the deterministic suite already covers
 * everything countable, so the judge is reserved for the three questions a rule
 * cannot answer — is each cited claim actually supported by the snippet it
 * cites, is every numeric comparison directionally right, and does the note
 * answer the question that was asked.
 *
 * Kept opt-in (`npm run eval:judge`) because it costs Groq calls and, on the
 * free tier's 8k tokens/minute ceiling, wall-clock time. The deterministic suite
 * is the one that belongs in CI.
 */
import { callGroq, parseJsonLoose } from "../lib/groq.ts";
import type { RunTranscript } from "../lib/transcript.ts";
import { citedBullets, parseSourcesBlock, type ScoreResult } from "./scorers.ts";

export const JUDGE_MODEL = "openai/gpt-oss-120b";

export type JudgeScorerId =
  | "judge/groundedness"
  | "judge/comparison-direction"
  | "judge/answers-question";

export const JUDGE_SCORERS: { id: JudgeScorerId; describes: string; threshold: number }[] = [
  {
    id: "judge/groundedness",
    describes:
      "Each cited claim is supported by the snippet it cites. Scores 1 for supported, 0.5 for partially supported (right direction, overstated or embellished), 0 for unsupported.",
    threshold: 0.85,
  },
  {
    id: "judge/comparison-direction",
    describes:
      'Numeric comparisons point the right way. Guards the specific failure the prompt was written against: "P/E of 149 is far above the 3-year average of 202". Non-comparable pairs score 0.5.',
    threshold: 0.9,
  },
  {
    id: "judge/answers-question",
    describes:
      "The summary and rating answer the question actually asked, not a generic version of it. A bear-case question must still get a bear-case-led answer.",
    threshold: 0.9,
  },
];

const SYSTEM = `You are grading an equity research note produced by an automated agent. You are strict, literal and terse.

You are given the user's question, the note's claims (each with the numbered sources it cites), and the exact source snippets the writer was shown — nothing more. Judge ONLY against those snippets. If a snippet does not contain the support, the claim is unsupported, even if you personally know it to be true.

Return ONLY JSON of this exact shape:
{"bullets":[{"id":string,"verdict":"supported"|"partial"|"unsupported","why":string}],
 "comparisons":[{"id":string,"quote":string,"verdict":"correct"|"incorrect"|"not_comparable","why":string}],
 "answersQuestion":{"verdict":"yes"|"partial"|"no","why":string}}

Definitions:
- supported: the snippet states the claim, or states it with only rounding/paraphrase differences.
- partial: directionally right but overstated, or only part of the claim is in the snippet.
- unsupported: the figure or the assertion is not in any cited snippet.
- comparisons: include ONE entry for every claim that compares two numbers ("above", "below", "trades at a discount to", "x versus y"). "incorrect" means the stated direction contradicts the numbers. "not_comparable" means the two figures are from different periods or definitions and should not have been compared at all. Return an empty array if the note makes no numeric comparison.
- answersQuestion: does the summary plus rating address the specific question? A question asking for the bear case must get a bear-led answer; a mechanism question must explain the mechanism.

Every "why" is at most 15 words. Include one bullets entry for every claim id given to you.`;

function buildUserPrompt(t: RunTranscript): string | null {
  if (!t.thesis || !t.synthesisCall) return null;
  const block = parseSourcesBlock(t.synthesisCall.user);
  const bullets = citedBullets(t.thesis);

  const claims = bullets
    .map((b) => `${b.id} (cites ${b.sourceIds.length ? b.sourceIds.join(", ") : "nothing"}): ${b.text}`)
    .join("\n");

  // Only the snippets something actually cites: an uncited source cannot support
  // or refute anything here, and the token budget is the binding constraint.
  const usedIds = [...new Set(bullets.flatMap((b) => b.sourceIds))].sort((a, b) => a - b);
  const snippets = usedIds
    .map((id) => {
      const s = block.get(id);
      if (!s) return `[${id}] MISSING — this id does not exist.`;
      // Passed through whole. The snippets are already trimmed to 350 chars by
      // mergeAndNumberSources, so this is exactly the text the writer was shown —
      // trimming them further here made the judge call supported claims
      // unsupported because the supporting figure sat past the cut.
      return `[${id}] ${s.title}${s.published ? ` (published ${s.published})` : ""}\n${s.snippet}`;
    })
    .join("\n\n");

  return `QUESTION: ${t.question}

RATING: ${t.thesis.rating}
SUMMARY: ${t.thesis.summary}
VALUATION: ${t.thesis.valuationSummary}

CLAIMS:
${claims}

SOURCE SNIPPETS:
${snippets}

Grade now.`;
}

const BULLET_SCORE = { supported: 1, partial: 0.5, unsupported: 0 } as const;
const COMPARISON_SCORE = { correct: 1, not_comparable: 0.5, incorrect: 0 } as const;
const ANSWER_SCORE = { yes: 1, partial: 0.5, no: 0 } as const;

type JudgeResponse = {
  bullets?: { id?: string; verdict?: keyof typeof BULLET_SCORE; why?: string }[];
  comparisons?: { id?: string; quote?: string; verdict?: keyof typeof COMPARISON_SCORE; why?: string }[];
  answersQuestion?: { verdict?: keyof typeof ANSWER_SCORE; why?: string };
};

const NA: ScoreResult = { score: null, detail: "not applicable", failures: [] };

export type JudgeOutcome = {
  results: Record<JudgeScorerId, ScoreResult>;
  tokens: number;
  error?: string;
};

function allNA(detail: string, failures: string[] = []): Record<JudgeScorerId, ScoreResult> {
  const r = { score: null, detail, failures };
  return {
    "judge/groundedness": r,
    "judge/comparison-direction": r,
    "judge/answers-question": r,
  };
}

/** Grades one run. Never throws: a judge outage must not fail the whole suite. */
export async function judgeRun(t: RunTranscript): Promise<JudgeOutcome> {
  const user = buildUserPrompt(t);
  if (!user) return { results: allNA("no thesis to grade"), tokens: 0 };

  let raw: string;
  let tokens = 0;
  try {
    // temperature 0: a grader that disagrees with itself between runs turns
    // every eval delta into noise.
    const res = await callGroq({ model: JUDGE_MODEL, system: SYSTEM, user, temperature: 0 });
    raw = res.content;
    tokens = res.usage.total_tokens ?? 0;
  } catch (err) {
    return { results: allNA("judge call failed"), tokens: 0, error: (err as Error).message };
  }

  let parsed: JudgeResponse;
  try {
    parsed = parseJsonLoose<JudgeResponse>(raw);
  } catch (err) {
    return { results: allNA("judge returned unparseable JSON"), tokens, error: (err as Error).message };
  }

  const bullets = parsed.bullets ?? [];
  const graded = bullets.filter((b) => b.verdict && b.verdict in BULLET_SCORE);
  const expected = citedBullets(t.thesis!).length;
  const groundedness: ScoreResult = graded.length
    ? {
        score: graded.reduce((sum, b) => sum + BULLET_SCORE[b.verdict!], 0) / graded.length,
        // Coverage is reported rather than silently averaged away: a judge that
        // graded 4 of 15 claims is a broken measurement, not a good score.
        detail: `${graded.length}/${expected} claims graded`,
        failures: graded
          .filter((b) => b.verdict !== "supported")
          .map((b) => `${b.id ?? "?"} — ${b.verdict}: ${b.why ?? ""}`),
      }
    : { ...NA, detail: "judge graded no claims" };

  const comparisons = (parsed.comparisons ?? []).filter((c) => c.verdict && c.verdict in COMPARISON_SCORE);
  const comparisonDirection: ScoreResult = comparisons.length
    ? {
        score: comparisons.reduce((sum, c) => sum + COMPARISON_SCORE[c.verdict!], 0) / comparisons.length,
        detail: `${comparisons.length} comparison(s)`,
        failures: comparisons
          .filter((c) => c.verdict !== "correct")
          .map((c) => `${c.id ?? "?"} — ${c.verdict}: ${c.quote ?? ""} (${c.why ?? ""})`),
      }
    : { ...NA, detail: "no numeric comparisons made" };

  const aq = parsed.answersQuestion;
  const answersQuestion: ScoreResult =
    aq?.verdict && aq.verdict in ANSWER_SCORE
      ? {
          score: ANSWER_SCORE[aq.verdict],
          detail: aq.verdict,
          failures: aq.verdict === "yes" ? [] : [`${aq.verdict}: ${aq.why ?? ""}`],
        }
      : { ...NA, detail: "judge returned no verdict" };

  return {
    results: {
      "judge/groundedness": groundedness,
      "judge/comparison-direction": comparisonDirection,
      "judge/answers-question": answersQuestion,
    },
    tokens,
  };
}
