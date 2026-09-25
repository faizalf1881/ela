import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { aiSettingView, getAiSetting } from "@/lib/ai/config";
import { encryptSecret, secretHint } from "@/lib/secret-box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/ai — AI assistant settings (spec #43). The key is never returned. */
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await aiSettingView());
}

const url = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Enter a full address starting with http:// or https://");

const schema = z.object({
  provider: z.enum(["DISABLED", "OPENAI", "OLLAMA"]).optional(),
  openaiModel: z.string().trim().min(1).max(80).regex(/^[\w.:-]+$/, "Model names use letters, digits, '.', ':' and '-'").optional(),
  // A new key replaces the stored one; "" removes it. Omitted = unchanged.
  openaiKey: z.string().trim().max(300).optional(),
  openaiBaseUrl: url.optional(),
  ollamaUrl: url.optional(),
  ollamaModel: z.string().trim().min(1).max(80).regex(/^[\w.:/-]+$/, "Model names use letters, digits, '.', ':', '/' and '-'").optional(),
  temperature: z.number().min(0).max(1).optional(),
  instructions: z.string().max(4000).optional(),
});

/** PATCH /api/admin/ai — admin only. */
export async function PATCH(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid settings" }, { status: 400 });
  const d = parsed.data;
  await getAiSetting();

  const data: Record<string, unknown> = {};
  const changes: string[] = [];
  if (d.provider) {
    data.provider = d.provider;
    changes.push(`provider ${d.provider}`);
  }
  if (d.openaiModel) data.openaiModel = d.openaiModel;
  if (d.openaiKey !== undefined) {
    if (d.openaiKey === "") {
      data.openaiKeyEnc = null;
      data.openaiKeyHint = null;
      changes.push("OpenAI key removed");
    } else {
      if (!/^sk-[\w-]{20,}$/.test(d.openaiKey)) return NextResponse.json({ error: "That doesn't look like an OpenAI API key (it starts with sk-)." }, { status: 400 });
      try {
        data.openaiKeyEnc = encryptSecret(d.openaiKey);
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
      }
      data.openaiKeyHint = secretHint(d.openaiKey);
      changes.push("OpenAI key replaced");
    }
  }
  if (d.openaiBaseUrl !== undefined) data.openaiBaseUrl = d.openaiBaseUrl || null;
  if (d.ollamaUrl !== undefined) data.ollamaUrl = d.ollamaUrl || null;
  if (d.ollamaModel) data.ollamaModel = d.ollamaModel;
  if (d.temperature !== undefined) data.temperature = d.temperature;
  if (d.instructions !== undefined) data.instructions = d.instructions.trim() || null;

  await prisma.aiSetting.update({ where: { id: 1 }, data });
  await audit({
    actor: actorFrom(s),
    action: "ai.settings_updated",
    entityType: "aiSetting",
    summary: `AI assistant settings updated${changes.length ? `: ${changes.join(", ")}` : ""}`,
    // Never log the key itself.
    metadata: { ...d, openaiKey: d.openaiKey === undefined ? undefined : d.openaiKey ? "(replaced)" : "(removed)" },
    req,
  });
  return NextResponse.json(await aiSettingView());
}
