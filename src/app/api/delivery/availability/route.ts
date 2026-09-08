import { NextResponse } from "next/server";
import { getAvailability } from "@/lib/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // depends on the current time

// GET /api/delivery/availability?locationId=... — dates + slots the customer may pick.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("locationId");
  const data = await getAvailability(locationId);
  return NextResponse.json(data);
}
