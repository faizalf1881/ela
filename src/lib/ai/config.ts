import "server-only";
import { prisma } from "../db";
import { decryptSecret } from "../secret-box";
import { ollamaProvider, openAiProvider, type AiProvider } from "./providers";

export type AiProviderName = "DISABLED" | "OPENAI" | "OLLAMA";

export async function getAiSetting() {
  return (await prisma.aiSetting.findUnique({ where: { id: 1 } })) ?? (await prisma.aiSetting.create({ data: { id: 1 } }));
}

/** The admin view of the settings: never includes the key itself. */
export async function aiSettingView() {
  const s = await getAiSetting();
  const stored = s.openaiKeyEnc ? decryptSecret(s.openaiKeyEnc) : null;
  return {
    provider: s.provider as AiProviderName,
    openaiModel: s.openaiModel,
    openaiBaseUrl: s.openaiBaseUrl,
    // Where the OpenAI key comes from: the admin panel (encrypted) or the server env.
    keySource: stored ? "admin" : process.env.OPENAI_API_KEY ? "env" : null,
    keyHint: stored ? s.openaiKeyHint : null,
    keyUnreadable: !!s.openaiKeyEnc && !stored,
    ollamaUrl: s.ollamaUrl,
    ollamaModel: s.ollamaModel,
    temperature: s.temperature,
    instructions: s.instructions,
  };
}

/** The configured provider, or why there isn't one. */
export async function resolveProvider(): Promise<{ provider: AiProvider; instructions: string | null } | { provider: null; reason: string }> {
  const s = await getAiSetting();
  if (s.provider === "OPENAI") {
    const apiKey = decryptSecret(s.openaiKeyEnc) || process.env.OPENAI_API_KEY;
    if (!apiKey) return { provider: null, reason: "OpenAI is selected but no API key is set." };
    return {
      provider: openAiProvider({ apiKey, model: s.openaiModel, baseUrl: s.openaiBaseUrl, temperature: s.temperature }),
      instructions: s.instructions,
    };
  }
  if (s.provider === "OLLAMA") {
    if (!s.ollamaUrl) return { provider: null, reason: "Ollama is selected but no server address is set." };
    return { provider: ollamaProvider({ url: s.ollamaUrl, model: s.ollamaModel, temperature: s.temperature }), instructions: s.instructions };
  }
  return { provider: null, reason: "The AI assistant is turned off." };
}
