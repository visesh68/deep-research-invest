import fs from "node:fs/promises";
import path from "node:path";
import type { AngleSearchLog } from "./tavily";
import type { GroqUsage } from "./groq";
import type { ResearchPlan, Thesis } from "./schema";

export type LlmCallLog = {
  model: string;
  system: string;
  user: string;
  response: string;
  usage: GroqUsage;
  ms: number;
};

export type RunTranscript = {
  runId: string;
  startedAt: string;
  question: string;
  plan?: ResearchPlan;
  planCall?: LlmCallLog;
  tavily: AngleSearchLog[];
  researchFailures?: { angleId: string; query: string; error: string }[];
  synthesisCall?: LlmCallLog;
  thesis?: Thesis;
  thesisValidation?: { success: boolean; issues?: unknown };
  totalTokens: { prompt: number; completion: number; total: number };
  totalMs: number;
  error?: string;
};

export function createTranscript(question: string): RunTranscript {
  return {
    runId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    question,
    tavily: [],
    totalTokens: { prompt: 0, completion: 0, total: 0 },
    totalMs: 0,
  };
}

export function addUsage(t: RunTranscript, usage: GroqUsage) {
  t.totalTokens.prompt += usage.prompt_tokens ?? 0;
  t.totalTokens.completion += usage.completion_tokens ?? 0;
  t.totalTokens.total += usage.total_tokens ?? 0;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function finalizeTranscript(t: RunTranscript): Promise<string | null> {
  if (process.env.VERCEL) {
    // Vercel's runtime filesystem is ephemeral/read-only for deployments;
    // local transcript logging is a dev-only feature by design.
    return null;
  }

  try {
    const slug = slugify(t.question) || "run";
    const filename = `${t.startedAt.replace(/[:.]/g, "-")}_${slug}.json`;
    const dir = path.join(process.cwd(), "transcripts");
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, JSON.stringify(t, null, 2));
    return filePath;
  } catch (err) {
    console.error("Failed to write transcript:", err);
    return null;
  }
}
