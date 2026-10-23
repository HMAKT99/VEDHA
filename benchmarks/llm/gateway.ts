/**
 * Minimal OpenAI-compatible client for Vercel AI Gateway, pinned to one provider with no fallback.
 * Cost guard: any response reporting a non-zero cost, or too many calls, aborts the run.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  message: ChatMessage;
  promptTokens: number;
  completionTokens: number;
}

export class CostGuardError extends Error {}

/** Free tier allows 5 requests/minute for the whole team; stay under it. */
const MIN_GAP_MS = 13_000;

export class Gateway {
  private lastCall = 0;
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;
  constructor(
    readonly model: string,
    readonly provider: string,
    private readonly maxCalls: number,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult> {
    const key = process.env.AI_GATEWAY_API_KEY;
    if (!key) throw new Error("AI_GATEWAY_API_KEY is not set");
    for (let attempt = 0; ; attempt++) {
      if (this.calls >= this.maxCalls)
        throw new CostGuardError(`call cap ${this.maxCalls} reached`);
      const wait = this.lastCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      this.calls++;
      const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1500,
          temperature: 0,
          messages,
          tools,
          tool_choice: "auto",
          providerOptions: { gateway: { only: [this.provider], order: [this.provider] } },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, res.status === 429 ? 61_000 : 3000 * (attempt + 1)));
        continue;
      }
      const j = (await res.json()) as {
        choices?: Array<{ message: ChatMessage }>;
        usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
        error?: { message?: string };
      };
      if (!res.ok || !j.choices?.[0])
        throw new Error(`gateway ${res.status}: ${j.error?.message ?? "no choices"}`);
      const cost = j.usage?.cost ?? 0;
      if (cost > 0) throw new CostGuardError(`non-zero cost reported: ${cost}`);
      this.promptTokens += j.usage?.prompt_tokens ?? 0;
      this.completionTokens += j.usage?.completion_tokens ?? 0;
      return {
        message: j.choices[0].message,
        promptTokens: j.usage?.prompt_tokens ?? 0,
        completionTokens: j.usage?.completion_tokens ?? 0,
      };
    }
  }
}
