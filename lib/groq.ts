export type GroqUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type GroqCallResult = {
  content: string;
  model: string;
  usage: GroqUsage;
  ms: number;
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function callGroq(opts: {
  model: string;
  system: string;
  user: string;
  temperature?: number;
}): Promise<GroqCallResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const started = Date.now();
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.25,
      response_format: { type: "json_object" },
      // Both calls are extraction/formatting rather than open-ended reasoning;
      // low effort cuts roughly half the completion tokens per run.
      reasoning_effort: "low",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const json = await res.json();
  const ms = Date.now() - started;
  const content = json.choices?.[0]?.message?.content ?? "";
  const usage: GroqUsage = json.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  return { content, model: opts.model, usage, ms };
}

export function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
