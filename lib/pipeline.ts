import { callGroq, parseJsonLoose } from "./groq";
import { buildPlanPrompt, buildSynthesisPrompt } from "./prompts";
import { ResearchPlanSchema, ThesisSchema, type Thesis } from "./schema";
import { runAllAngles } from "./tavily";
import { mergeAndNumberSources } from "./sources";
import { addUsage, createTranscript, finalizeTranscript, type RunTranscript } from "./transcript";

const PLAN_MODEL = "llama-3.1-8b-instant";
const SYNTHESIS_MODEL = "llama-3.3-70b-versatile";

export class PipelineError extends Error {
  constructor(
    message: string,
    public stage: "plan" | "research" | "synthesis",
  ) {
    super(message);
  }
}

export async function runPipeline(question: string): Promise<{
  thesis: Thesis;
  transcript: RunTranscript;
}> {
  const started = Date.now();
  const transcript = createTranscript(question);

  try {
    // 1. Decompose into company/ticker + research angles.
    const planPrompt = buildPlanPrompt(question);
    const planCallStart = Date.now();
    let planResult;
    try {
      planResult = await callGroq({
        model: PLAN_MODEL,
        system: planPrompt.system,
        user: planPrompt.user,
      });
    } catch (err) {
      throw new PipelineError(`Planning call failed: ${(err as Error).message}`, "plan");
    }

    transcript.planCall = {
      model: planResult.model,
      system: planPrompt.system,
      user: planPrompt.user,
      response: planResult.content,
      usage: planResult.usage,
      ms: Date.now() - planCallStart,
    };
    addUsage(transcript, planResult.usage);

    let plan;
    try {
      const rawPlan = parseJsonLoose(planResult.content);
      plan = ResearchPlanSchema.parse(rawPlan);
    } catch (err) {
      throw new PipelineError(
        `Failed to parse research plan: ${(err as Error).message}`,
        "plan",
      );
    }
    transcript.plan = plan;

    // 2. Parallel research across angles.
    let byAngle, log;
    try {
      ({ byAngle, log } = await runAllAngles(plan.angles));
    } catch (err) {
      throw new PipelineError(`Research search failed: ${(err as Error).message}`, "research");
    }
    transcript.tavily = log;

    const { sourcesBlock, sources } = mergeAndNumberSources(byAngle);

    // 3. Single synthesis call producing the final structured thesis.
    const synthesisPrompt = buildSynthesisPrompt(question, plan, sourcesBlock);
    const synthesisCallStart = Date.now();
    let synthesisResult;
    try {
      synthesisResult = await callGroq({
        model: SYNTHESIS_MODEL,
        system: synthesisPrompt.system,
        user: synthesisPrompt.user,
      });
    } catch (err) {
      throw new PipelineError(`Synthesis call failed: ${(err as Error).message}`, "synthesis");
    }

    transcript.synthesisCall = {
      model: synthesisResult.model,
      system: synthesisPrompt.system,
      user: synthesisPrompt.user,
      response: synthesisResult.content,
      usage: synthesisResult.usage,
      ms: Date.now() - synthesisCallStart,
    };
    addUsage(transcript, synthesisResult.usage);

    let thesis: Thesis;
    try {
      const rawThesis = parseJsonLoose<Record<string, unknown>>(synthesisResult.content);
      // Prefer our own numbered/deduped source list over whatever the model echoed back.
      rawThesis.sources = sources;
      const parsed = ThesisSchema.safeParse(rawThesis);
      transcript.thesisValidation = parsed.success
        ? { success: true }
        : { success: false, issues: parsed.error.issues };
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      }
      thesis = parsed.data;
    } catch (err) {
      throw new PipelineError(
        `Failed to parse thesis output: ${(err as Error).message}`,
        "synthesis",
      );
    }

    transcript.thesis = thesis;
    transcript.totalMs = Date.now() - started;
    await finalizeTranscript(transcript);

    return { thesis, transcript };
  } catch (err) {
    transcript.error = (err as Error).message;
    transcript.totalMs = Date.now() - started;
    await finalizeTranscript(transcript);
    throw err;
  }
}
