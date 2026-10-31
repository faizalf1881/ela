import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fetchNumberHealth } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the sending number's quality rating and daily messaging limit (for campaigns). */
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await fetchNumberHealth());
}
