import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { z } from "zod";
import { changeHandling } from "@/lib/wa-chat";

export const runtime = "nodejs";

const schema = z.object({
  state: z.enum(["HUMAN_HANDLING", "WAITING_CUSTOMER", "REQUIRES_ATTENTION"]),
  reason: z.string().trim().max(200).optional(),
});

/** POST — staff mark a conversation they are handling (spec #42). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = { label: actorFrom(s).label || "Admin" };
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  if (conv.mode !== "HUMAN") return NextResponse.json({ error: "Take over the conversation first." }, { status: 409 });
  const conversation = await changeHandling(
    id,
    { state: parsed.data.state, reason: parsed.data.state === "REQUIRES_ATTENTION" ? parsed.data.reason || `Flagged by ${staff.label}` : null },
    { type: "staff", label: staff.label },
  );
  return NextResponse.json({ conversation });
}
