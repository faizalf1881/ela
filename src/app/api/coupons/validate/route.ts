import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { evaluateCoupon } from "@/lib/coupon";

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  subtotal: z.number().int().min(0),
});

// POST /api/coupons/validate — customer checks a coupon before placing an order.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") return NextResponse.json({ error: "Please log in" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });

  const result = await evaluateCoupon(parsed.data.code, parsed.data.subtotal);
  if (!result.ok) return NextResponse.json(result, { status: 200 });
  return NextResponse.json(result);
}
