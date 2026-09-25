import "server-only";

/**
 * The AI assistant talks to a provider through this one small interface, so
 * switching between OpenAI and a self-hosted Ollama model (spec #43) is a
 * setting, not a code change.
 */
export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export interface AiProvider {
  /** e.g. "OpenAI gpt-4o-mini" — for logs and the admin test button. */
  label: string;
  /** Returns the model's reply text. `json` asks for a single JSON object. */
  chat(turns: ChatTurn[], opts?: { json?: boolean }): Promise<string>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const TIMEOUT_MS = 25_000;

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return j?.error?.message || j?.error || text;
  } catch {
    return text || res.statusText;
  }
}

// Reasoning models (o1/o3/o4…, gpt-5…) accept only the default temperature and
// spend part of the token budget thinking.
const isReasoningModel = (model: string) => /^(o\d|gpt-5)/i.test(model);

export function openAiProvider(cfg: { apiKey: string; model: string; baseUrl?: string | null; temperature: number }): AiProvider {
  const base = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const reasoning = isReasoningModel(cfg.model);

  async function call(turns: ChatTurn[], json: boolean, withTemperature: boolean): Promise<Response> {
    return fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: turns,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        ...(withTemperature ? { temperature: cfg.temperature } : {}),
        ...(reasoning ? { max_completion_tokens: 2500, reasoning_effort: "low" } : { max_completion_tokens: 600 }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    label: `OpenAI ${cfg.model}`,
    async chat(turns, opts = {}) {
      let res: Response;
      try {
        res = await call(turns, !!opts.json, !reasoning);
        // Some models reject a custom temperature: retry once without it.
        if (res.status === 400 && !reasoning) {
          const err = await readError(res.clone());
          if (/temperature/i.test(err)) res = await call(turns, !!opts.json, false);
        }
      } catch (e) {
        throw new AiError(`Could not reach OpenAI: ${(e as Error).message}`);
      }
      if (!res.ok) throw new AiError(`OpenAI ${res.status}: ${await readError(res)}`, res.status);
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new AiError("OpenAI returned an empty reply");
      return content;
    },
  };
}

export function ollamaProvider(cfg: { url: string; model: string; temperature: number }): AiProvider {
  const base = cfg.url.replace(/\/$/, "");
  return {
    label: `Ollama ${cfg.model}`,
    async chat(turns, opts = {}) {
      let res: Response;
      try {
        res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: cfg.model,
            messages: turns,
            stream: false,
            ...(opts.json ? { format: "json" } : {}),
            options: { temperature: cfg.temperature },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new AiError(`Could not reach Ollama at ${base}: ${(e as Error).message}`);
      }
      if (!res.ok) throw new AiError(`Ollama ${res.status}: ${await readError(res)}`, res.status);
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content?.trim();
      if (!content) throw new AiError("Ollama returned an empty reply");
      return content;
    },
  };
}
