import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { handBackToAi } from "@/lib/wa-chat";

export const runtime = "nodejs";

/** POST — switch the chat back to the AI, the only way it resumes (spec #41). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = { label: actorFrom(s).label || "Admin" };
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conversation = await handBackToAi(id, staff, req);
  return NextResponse.json({ conversation });
}
