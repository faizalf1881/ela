import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (session) {
    await audit({ actor: actorFrom(session), action: "auth.logout", entityType: "auth", entityId: session.sub, summary: "Signed out", req });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
