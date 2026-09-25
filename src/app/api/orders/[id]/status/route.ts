import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { changeOrderStatus, StatusChangeError } from "@/lib/order-flow";

export const runtime = "nodejs";

const STATUSES = ["PENDING", "PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
const schema = z.object({ status: z.enum(STATUSES) });

// PATCH /api/orders/[id]/status — kitchen + admin.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || (s.role !== "kitchen" && s.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const { order, changed, from } = await changeOrderStatus({
      orderId: id,
      to: parsed.data.status,
      actor: actorFrom(s),
      via: "board",
      req,
    });
    return NextResponse.json({ order, changed, from });
  } catch (e) {
    if (e instanceof StatusChangeError) return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    throw e;
  }
}
