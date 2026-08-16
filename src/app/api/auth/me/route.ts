import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMembership, NO_MEMBERSHIP } from "@/lib/membership";

export async function GET() {
  const user = await getSession();
  // Membership drives the premium UI (badge, gold theme) and benefit hints.
  const membership = user?.role === "customer" ? await getMembership(user.sub) : NO_MEMBERSHIP;
  return NextResponse.json({ user, membership });
}
