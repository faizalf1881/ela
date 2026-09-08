import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateMealPlanOrders } from "@/lib/meal-plan";
import { istDateKey } from "@/lib/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily meal-plan order generation.
 *
 * Runs from Vercel Cron (which sends `Authorization: Bearer $CRON_SECRET`), and
 * can also be triggered by a logged-in admin from the Memberships screen.
 * Generating twice is harmless — the generator is idempotent per service date.
 */
async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  const s = await getSession();
  return s?.role === "admin";
}

export async function GET(req: Request) {
  if (!(await authorize(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || istDateKey();
  // Only a signed-in admin may override a closed store; the scheduled run never does.
  const force = searchParams.get("force") === "1" && (await getSession())?.role === "admin";
  const result = await generateMealPlanOrders(date, { force });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
