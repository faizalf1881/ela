import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveProvider } from "@/lib/ai/config";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST /api/admin/ai/test — checks the configured provider answers. */
export async function POST() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const resolved = await resolveProvider();
  if (!resolved.provider) return NextResponse.json({ ok: false, error: resolved.reason }, { status: 400 });

  const started = Date.now();
  try {
    const reply = await resolved.provider.chat(
      [
        { role: "system", content: 'You are a connection test. Answer with the JSON object {"reply": "Namaskaram! The assistant is ready."}' },
        { role: "user", content: "ping" },
      ],
      { json: true },
    );
    return NextResponse.json({ ok: true, provider: resolved.provider.label, ms: Date.now() - started, reply: reply.slice(0, 300) });
  } catch (e) {
    return NextResponse.json({ ok: false, provider: resolved.provider.label, error: (e as Error).message }, { status: 502 });
  }
}
