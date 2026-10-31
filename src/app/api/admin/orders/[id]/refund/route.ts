import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { changeOrderStatus, StatusChangeError } from "@/lib/order-flow";
import { refundOrder, RefundError } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({
  /** true = the money was already returned outside the system; just record it. */
  manual: z.boolean().default(false),
  /** Also cancel the order (and tell the customer) if it isn't delivered yet. */
  cancel: z.boolean().default(false),
  note: z.string().trim().max(100).default(""),
});

/** POST /api/admin/orders/[id]/refund — admin only (spec #12). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    let order = await refundOrder({ orderId: id, manual: parsed.data.manual, note: parsed.data.note, actor: actorFrom(s), req });
    if (parsed.data.cancel && order.status !== "CANCELLED" && order.status !== "DELIVERED") {
      order = (await changeOrderStatus({ orderId: id, to: "CANCELLED", actor: actorFrom(s), via: "board", req })).order as typeof order;
    }
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof RefundError) return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    if (e instanceof StatusChangeError) return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    throw e;
  }
}
